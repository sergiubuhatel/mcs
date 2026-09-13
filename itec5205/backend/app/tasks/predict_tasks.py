"""Background job: train a per-ticker LSTM price predictor and store the
forecast. Training loops over epochs synchronously, so it's run out of the
request/response cycle the same way import/RL jobs are.
"""

from ..db.arango_client import get_db
from ..extensions import socketio
from ..services.lstm_service import train_and_predict
from .celery_app import celery_app


@celery_app.task(bind=True, name="train_lstm_prediction")
def train_lstm_prediction(self, ticker: str, seq_len: int = 20, epochs: int = 30, hidden_size: int = 32, forecast_days: int = 7):
    room = self.request.id

    def on_epoch(epoch, total_epochs, loss):
        progress = {"stage": "training", "ticker": ticker, "completed": epoch, "total": total_epochs, "loss": loss}
        self.update_state(state="PROGRESS", meta=progress)
        socketio.emit("prediction_progress", progress, room=room)

    result = train_and_predict(
        ticker=ticker, seq_len=seq_len, epochs=epochs, hidden_size=hidden_size, forecast_days=forecast_days, on_epoch=on_epoch
    )

    db = get_db()
    doc = {k: v for k, v in result.items() if k != "ticker"}
    doc["_key"] = result["ticker"]
    db.collection("price_predictions").insert(doc, overwrite=True)

    socketio.emit("prediction_progress", {"stage": "done", **result}, room=room)
    return result
