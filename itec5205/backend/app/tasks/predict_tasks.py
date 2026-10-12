"""Background job: train a per-ticker LSTM price predictor and store the
forecast. Training loops over epochs (with early stopping) synchronously, so it's run out of the
request/response cycle the same way import/RL jobs are.
"""

from ..db.arango_client import get_db
from ..extensions import socketio
from ..services.lstm_service import DEFAULT_LOOKBACK_DAYS, train_and_predict
from ..services.horizons import MAX_HORIZON_DAYS
from .celery_app import celery_app
from .stop_flags import raise_if_stopped


@celery_app.task(bind=True, name="train_lstm_prediction")
def train_lstm_prediction(
    self,
    ticker: str,
    seq_len: int = 20,
    epochs: int = 100,
    hidden_size: int = 32,
    forecast_days: int = MAX_HORIZON_DAYS,
    lookback_days: int | None = DEFAULT_LOOKBACK_DAYS,
):
    room = self.request.id
    raise_if_stopped(room)  # cancelled while still queued

    def on_epoch(epoch, total_epochs, loss, val_loss):
        raise_if_stopped(room)
        progress = {
            "stage": "training", "ticker": ticker, "completed": epoch, "total": total_epochs,
            "loss": loss, "val_loss": val_loss,
        }
        self.update_state(state="PROGRESS", meta=progress)
        socketio.emit("prediction_progress", progress, room=room)

    result = train_and_predict(
        ticker=ticker, seq_len=seq_len, epochs=epochs, hidden_size=hidden_size, forecast_days=forecast_days,
        lookback_days=lookback_days, on_epoch=on_epoch,
    )

    db = get_db()
    doc = {k: v for k, v in result.items() if k != "ticker"}
    doc["_key"] = result["ticker"]
    db.collection("price_predictions").insert(doc, overwrite=True)

    socketio.emit("prediction_progress", {"stage": "done", **result}, room=room)
    return result
