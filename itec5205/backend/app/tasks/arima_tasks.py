"""Background job: fit a per-ticker ARIMA price model and store the forecast.
The (p, q) order search fits up to (max_p+1)*(max_q+1) models, so it runs
out of the request/response cycle on its own `arima` queue, separate from
the LSTM worker.
"""

import math

from ..db.arango_client import get_db
from ..extensions import socketio
from ..services.arima_service import train_and_predict
from ..services.lstm_service import DEFAULT_LOOKBACK_DAYS
from ..services.horizons import MAX_HORIZON_DAYS
from .celery_app import celery_app


@celery_app.task(bind=True, name="train_arima_prediction")
def train_arima_prediction(
    self,
    ticker: str,
    order: list[int] | None = None,
    d: int = 1,
    max_p: int = 3,
    max_q: int = 3,
    lookback_days: int | None = DEFAULT_LOOKBACK_DAYS,
    forecast_days: int = MAX_HORIZON_DAYS,
):
    room = self.request.id

    def on_step(step, total_steps, tried, aic, best):
        progress = {
            "stage": "fitting", "ticker": ticker, "completed": step, "total": total_steps,
            "order": list(tried), "aic": aic if aic is not None and math.isfinite(aic) else None,
            "best_order": list(best) if best else None,
        }
        self.update_state(state="PROGRESS", meta=progress)
        socketio.emit("arima_progress", progress, room=room)

    result = train_and_predict(
        ticker=ticker, order=order, d=d, max_p=max_p, max_q=max_q,
        lookback_days=lookback_days, forecast_days=forecast_days, on_step=on_step,
    )

    db = get_db()
    doc = {k: v for k, v in result.items() if k != "ticker"}
    doc["_key"] = result["ticker"]
    db.collection("arima_predictions").insert(doc, overwrite=True)

    socketio.emit("arima_progress", {"stage": "done", **result}, room=room)
    return result
