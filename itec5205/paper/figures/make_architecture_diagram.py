"""Generate Fig. 1 (system architecture) for the research paper."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

fig, ax = plt.subplots(figsize=(3.4, 3.6))
ax.set_xlim(0, 10)
ax.set_ylim(0, 12)
ax.axis("off")

boxes = {
    "frontend": (1, 9.7, 8, 1.4, "React / Redux-Saga\n(Screener, Pools, Portfolios, RL & LSTM panels)"),
    "backend": (1, 7.4, 8, 1.4, "Flask REST API + Socket.IO\n(app/api, app/services)"),
    "redis": (0.7, 4.6, 3.6, 1.3, "Redis\n(Celery broker + Socket.IO pub/sub)"),
    "arango": (5.7, 4.6, 3.6, 1.3, "ArangoDB\n(companies, prices,\nratios, portfolios, ...)"),
    "worker": (1, 2.2, 8, 1.4, "Celery worker\n(bulk import, PPO training, LSTM training)"),
    "yahoo": (0.7, 0.2, 3.6, 1.2, "Yahoo Finance\n(yfinance)"),
    "ml": (5.7, 0.2, 3.6, 1.2, "stable-baselines3 (PPO)\nPyTorch (LSTM)"),
}

for key, (x, y, w, h, label) in boxes.items():
    fc = "#eef2ff" if key in ("frontend", "backend") else "#f5f5f5"
    box = FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.08,rounding_size=0.12",
                          linewidth=1.1, edgecolor="#333333", facecolor=fc)
    ax.add_patch(box)
    ax.text(x + w / 2, y + h / 2, label, ha="center", va="center", fontsize=6.6, wrap=True)


def arrow(p1, p2, label=None, dx=0):
    a = FancyArrowPatch(p1, p2, arrowstyle="-|>", mutation_scale=10, linewidth=1.1, color="#333333")
    ax.add_patch(a)
    if label:
        mx, my = (p1[0] + p2[0]) / 2 + dx, (p1[1] + p2[1]) / 2
        ax.text(mx, my, label, ha="center", va="center", fontsize=5.6, color="#333333",
                bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none"))


arrow((5, 9.7), (5, 8.8), "HTTP / WebSocket")
arrow((3, 7.4), (2.5, 5.9), "enqueue task")
arrow((7, 7.4), (7.5, 5.9), "AQL read/write")
arrow((2.5, 4.6), (2.5, 3.6), "pulls task")
arrow((7.5, 4.6), (7.5, 3.6), "read/write")
arrow((2.5, 2.2), (2.5, 1.4))
arrow((7.5, 2.2), (7.5, 1.4))

plt.tight_layout(pad=0.3)
plt.savefig("architecture.png", dpi=300, bbox_inches="tight")
print("saved architecture.png")
