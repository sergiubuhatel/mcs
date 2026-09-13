"""Builds ITEC5205_ResearchPaper.docx from the real IEEE trans_jour template
conventions (two-column body, numbered Roman-numeral sections, IEEE-style
numbered references), populated with this project's actual content.

Run: python build_paper.py   (from the paper/ directory)
"""

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

BODY_FONT = "Times New Roman"


def set_two_columns(section, num=2, space_twips=360):
    sectPr = section._sectPr
    cols = sectPr.find(qn("w:cols"))
    if cols is None:
        cols = OxmlElement("w:cols")
        sectPr.append(cols)
    cols.set(qn("w:num"), str(num))
    cols.set(qn("w:space"), str(space_twips))


def style_document(doc):
    normal = doc.styles["Normal"]
    normal.font.name = BODY_FONT
    normal.font.size = Pt(10)
    rpr = normal.element.get_or_add_rPr()
    rFonts = rpr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rpr.append(rFonts)
    rFonts.set(qn("w:eastAsia"), BODY_FONT)


def add_title(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(text)
    run.font.size = Pt(20)
    run.font.bold = True
    p.paragraph_format.space_after = Pt(4)
    return p


def add_authors(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(text)
    run.font.size = Pt(11)
    run.font.italic = True
    p.paragraph_format.space_after = Pt(14)
    return p


def add_abstract(doc, abstract_text, index_terms):
    p = doc.add_paragraph()
    r = p.add_run("Abstract—")
    r.bold = True
    r.italic = True
    r.font.size = Pt(9)
    r2 = p.add_run(abstract_text)
    r2.italic = True
    r2.font.size = Pt(9)
    p.paragraph_format.space_after = Pt(6)

    p2 = doc.add_paragraph()
    r = p2.add_run("Index Terms—")
    r.bold = True
    r.italic = True
    r.font.size = Pt(9)
    r2 = p2.add_run(index_terms)
    r2.italic = True
    r2.font.size = Pt(9)
    p2.paragraph_format.space_after = Pt(10)


def add_heading(doc, numeral, title):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    text = f"{numeral}. {title}" if numeral else title
    run = p.add_run(text.upper())
    run.bold = True
    run.font.size = Pt(10.5)
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(6)
    return p


def add_subheading(doc, text):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.italic = True
    run.bold = True
    run.font.size = Pt(10)
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(3)
    return p


def add_body(doc, text, first_line_indent=True):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    if first_line_indent:
        p.paragraph_format.first_line_indent = Inches(0.2)
    p.add_run(text).font.size = Pt(10)
    return p


def add_figure(doc, image_path, caption, width_in=3.2):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run()
    run.add_picture(image_path, width=Inches(width_in))
    p.paragraph_format.space_after = Pt(2)

    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = cap.add_run(caption)
    r.font.size = Pt(8.5)
    cap.paragraph_format.space_after = Pt(10)


def add_table(doc, headers, rows, caption, col_widths=None):
    cap = doc.add_paragraph()
    r = cap.add_run(caption)
    r.font.size = Pt(8.5)
    r.bold = False
    cap.paragraph_format.space_before = Pt(8)
    cap.paragraph_format.space_after = Pt(3)

    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Table Grid"
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(h)
        run.bold = True
        run.font.size = Pt(8.5)
    for r_idx, row in enumerate(rows, start=1):
        for c_idx, val in enumerate(row):
            cell = table.rows[r_idx].cells[c_idx]
            cell.text = ""
            run = cell.paragraphs[0].add_run(str(val))
            run.font.size = Pt(8.5)
    doc.add_paragraph().paragraph_format.space_after = Pt(6)
    return table


def add_reference(doc, number, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.2)
    p.paragraph_format.first_line_indent = Inches(-0.2)
    p.paragraph_format.space_after = Pt(2)
    run = p.add_run(f"[{number}] {text}")
    run.font.size = Pt(8.5)


def main():
    doc = Document()
    style_document(doc)
    section = doc.sections[0]
    section.page_height = Inches(11)
    section.page_width = Inches(8.5)
    section.top_margin = Inches(0.75)
    section.bottom_margin = Inches(1.0)
    section.left_margin = Inches(0.625)
    section.right_margin = Inches(0.625)

    add_title(
        doc,
        "A Data-Intensive Platform for S&P 500 Investment Screening and "
        "Reinforcement-Learning-Based Portfolio Optimization",
    )
    add_authors(
        doc,
        "Sergiu Buhatel\nMaster of Computer Science (Data Science, Analytics, and Artificial Intelligence), Carleton University, Ottawa, ON, Canada\nsergiubuhatel@cmail.carleton.ca",
    )

    abstract = (
        "Individual investors lack accessible tools that combine large-scale fundamental "
        "screening with quantitative portfolio construction. This paper presents the design "
        "and implementation of a full-stack, data-intensive application that (1) ingests and "
        "models price history, valuation, and financial-statement data for the S&P 500 "
        "universe in a document-oriented database (ArangoDB); (2) lets a user search and "
        "filter companies by profitability, debt, and valuation indicators and assemble a "
        "candidate investment pool; (3) trains a Proximal Policy Optimization (PPO) "
        "reinforcement-learning agent, formulated as a Markov Decision Process over historical "
        "daily returns, to recommend a long-only portfolio allocation that balances expected "
        "return against volatility; and (4) trains a per-asset Long Short-Term Memory (LSTM) "
        "network to forecast short-horizon prices. The system runs on an asynchronous "
        "architecture (Flask, Celery, Redis) that streams task progress to a React/Redux-Saga "
        "frontend over WebSockets, and is fully containerized with Docker Compose. On a pilot "
        "pool of ten large-capitalization stocks, the trained RL policy produced an allocation "
        "with an estimated annualized return of 23.2%, volatility of 12.4%, and Sharpe ratio "
        "of 1.88 over the training window, demonstrating the pipeline end to end; we outline "
        "the larger-scale, held-out backtest against equal-weight and mean-variance baselines "
        "planned for the full evaluation."
    )
    index_terms = (
        "reinforcement learning, portfolio optimization, stock screening, ArangoDB, LSTM, "
        "data-intensive applications, proximal policy optimization, financial time series"
    )

    set_two_columns(section, num=2, space_twips=360)

    add_abstract(doc, abstract, index_terms)

    # ---------------- I. INTRODUCTION ----------------
    add_heading(doc, "I", "Introduction")
    add_body(
        doc,
        "Modern equity markets generate data at a scale and heterogeneity that make "
        "investment analysis a genuine data-intensive application in the sense used "
        "throughout this course: daily price time series for hundreds of companies, "
        "irregularly structured financial-statement data (income statement, balance sheet, "
        "cash flow) that varies in the fields available per issuer, and derived analytics "
        "(ratios, forecasts, portfolio metrics) that must be recomputed as new data arrives. "
        "Retail investors are typically offered one half of this problem at a time: static "
        "screening tools that filter companies by valuation or profitability metrics, or "
        "robo-advisors that allocate a portfolio using a fixed mean-variance model, but "
        "rarely both together, and rarely backed by an adaptive, learned allocation policy.",
    )
    add_body(
        doc,
        "This paper describes a system that closes that gap end to end: a screening layer "
        "over normalized company/sector/industry/fundamental data, a mechanism for turning a "
        "screened result set into a named candidate pool, a reinforcement-learning agent that "
        "learns a risk-aware allocation over that pool from historical returns, and a "
        "complementary per-stock LSTM price forecaster. The contributions of this work are: "
        "(1) a document-oriented data model for heterogeneous, evolving per-ticker financial "
        "records, with sector/industry modeled as first-class, independently queryable "
        "entities; (2) an asynchronous ingestion and model-training pipeline (Celery/Redis) "
        "that streams live progress to the browser over WebSockets rather than blocking or "
        "silent polling; (3) a Markov Decision Process formulation of long-only portfolio "
        "allocation trained with Proximal Policy Optimization; (4) a per-asset LSTM price "
        "forecaster evaluated with held-out RMSE/MAE; and (5) a working, containerized, "
        "full-stack implementation (Flask, ArangoDB, Redis, Celery, React/Redux-Saga) "
        "evaluated on live market data pulled from Yahoo Finance.",
    )
    add_body(
        doc,
        "The remainder of this paper is organized as follows. Section II surveys related "
        "work in portfolio theory, reinforcement learning for trading, deep learning for "
        "price forecasting, and data management for data-intensive applications. Section III "
        "describes the system architecture and data model. Section IV details the proposed "
        "RL formulation and the LSTM forecaster. Section V reports a pilot evaluation. "
        "Section VI concludes and outlines the full evaluation plan.",
    )

    # ---------------- II. RELATED WORK ----------------
    add_heading(doc, "II", "Related Work")

    add_subheading(doc, "A. Portfolio Theory and Fundamental Screening")
    add_body(
        doc,
        "Markowitz's mean-variance framework [1] remains the classical baseline for "
        "portfolio construction, choosing weights that minimize variance for a given "
        "expected return. Practical screening tools typically stop at filtering a universe "
        "by valuation and quality ratios (P/E, ROE, debt-to-equity) without a subsequent "
        "optimization step; this project treats screening as the first stage of a pipeline "
        "that ends in an explicit, learned allocation.",
    )

    add_subheading(doc, "B. Reinforcement Learning for Portfolio Management")
    add_body(
        doc,
        "Jiang et al. [2] proposed a model-free deep RL framework (the Ensemble of Identical "
        "Independent Evaluators) that outputs portfolio weights directly from a "
        "convolutional/recurrent network over historical price tensors, trained with a "
        "reward tied directly to portfolio return. This work adopts the same "
        "weights-as-policy-output idea but with a simpler flat-vector policy over a rolling "
        "window of returns, trained with Proximal Policy Optimization (PPO) [3], and a "
        "reward that explicitly penalizes trailing volatility rather than optimizing return "
        "alone, to bias the agent toward the low-risk/high-return portfolios this system is "
        "meant to recommend.",
    )

    add_subheading(doc, "C. Deep Learning for Price Forecasting")
    add_body(
        doc,
        "Fischer and Krauss [4] showed that LSTM networks can produce more accurate "
        "directional forecasts of S&P 500 constituent returns than momentum-based and "
        "memory-free benchmarks, framing the problem as cross-sectional return "
        "classification. This system instead trains one LSTM per ticker as a direct "
        "multi-step regressor over raw closing prices; Section V reports that this simpler "
        "formulation is materially harder to fit well at low training budgets, consistent "
        "with the broader finding in [4] that naive price-level regression is a weak "
        "baseline compared to return- or direction-based formulations.",
    )

    add_subheading(doc, "D. Data Management for Data-Intensive Applications")
    add_body(
        doc,
        "This project applies data-modeling and pipeline-design principles from Kleppmann "
        "[5] directly: a document database (ArangoDB) was chosen over a rigid relational "
        "schema because financial-statement coverage genuinely varies by issuer (not every "
        "company reports every line item), which document storage tolerates without schema "
        "migrations; and the import/training workload is treated as an asynchronous, "
        "queue-driven pipeline (Celery over Redis) rather than a synchronous request, "
        "reflecting the batch/stream-processing separation of concerns discussed in [5]. "
        "The broader context of algorithms and architectures for large-scale data analytics "
        "follows Li et al. [6].",
    )

    # ---------------- III. SYSTEM ARCHITECTURE ----------------
    add_heading(doc, "III", "System Architecture")
    add_body(
        doc,
        "Fig. 1 shows the system's five runtime components. A React/Redux-Saga frontend "
        "issues REST calls and joins per-task Socket.IO rooms; a Flask backend exposes the "
        "REST API and a Socket.IO server; Redis serves as both the Celery message broker and "
        "the Socket.IO pub/sub transport (the two roles are kept on separate logical Redis "
        "databases to avoid connection-pool interference); a Celery worker executes the three "
        "long-running jobs (bulk data import, PPO training, LSTM training) outside the "
        "request/response cycle; and ArangoDB persists all documents.",
    )
    add_figure(doc, "figures/architecture.png", "Fig. 1. System architecture and data/control flow.")

    add_subheading(doc, "A. Data Model")
    add_body(
        doc,
        "Ten ArangoDB document collections model the domain: companies (ticker-keyed "
        "profile), stock_prices (one document per ticker-day), stock_stats (latest "
        "valuation/market snapshot), financial_ratios (profitability/debt ratios derived "
        "from the income statement and balance sheet), sectors and industries (normalized, "
        "independently searchable entities rather than free-text fields on companies), "
        "pools (a named ticker subset saved off a screener search), portfolios (holdings "
        "with weights and computed risk/return metrics), rl_runs (PPO training metadata), "
        "and price_predictions (stored LSTM forecasts). Sector and industry names containing "
        "characters ArangoDB keys disallow (spaces, '&') are slugified for the document key "
        "while the original readable string is retained for display and filtering.",
    )

    add_subheading(doc, "B. Asynchronous Processing and Real-Time Progress")
    add_body(
        doc,
        "All three long-running operations (importing hundreds of tickers from Yahoo "
        "Finance, training a PPO agent, training an LSTM) are dispatched as Celery tasks; "
        "the API returns a task identifier immediately. Progress is pushed to the browser "
        "over a Socket.IO room named after the task id, with a REST polling endpoint kept as "
        "a fallback if the socket connection drops. On the frontend, a Redux-Saga generator "
        "races an eventChannel wrapping the socket against the polling fallback, dispatching "
        "whichever resolves first.",
    )

    add_subheading(doc, "C. Frontend")
    add_body(
        doc,
        "The frontend is organized as one Redux slice/saga pair per feature (companies, "
        "pools, portfolios, RL, predictions), with Redux-Saga (rather than thunks) chosen "
        "specifically because the RL/LSTM flows are event streams, not single request/"
        "response calls, which a saga's generator-based control flow expresses directly.",
    )

    # ---------------- IV. PROPOSED RL APPROACH ----------------
    add_heading(doc, "IV", "Proposed Reinforcement Learning Approach")

    add_subheading(doc, "A. MDP Formulation")
    add_body(
        doc,
        "Given a candidate pool of N tickers, let r_t in R^N be the vector of daily "
        "fractional returns on day t. The state at time t is the flattened window of the "
        "last W days of returns, [r_{t-W}, ..., r_{t-1}], concatenated with the current "
        "portfolio weights w_{t-1}. The action is a real-valued vector a_t in R^N, mapped to "
        "long-only weights via softmax: w_t = softmax(a_t), so weights are always "
        "non-negative and sum to one. The reward is r^T_t w_t - lambda * sigma_t, where "
        "sigma_t is the trailing standard deviation of the portfolio's own returns over the "
        "same window and lambda (risk_aversion) is a user-supplied coefficient; this directly "
        "encodes the low-risk/high-return objective rather than optimizing return alone.",
    )

    add_subheading(doc, "B. Training")
    add_body(
        doc,
        "The environment is implemented as a Gymnasium Env and trained with PPO from "
        "stable-baselines3 [7] using its default MLP policy. Training walks sequentially "
        "through the pool's historical daily returns; at inference time, the trained policy "
        "is applied to the most recent W-day window to produce today's recommended "
        "allocation, which is saved as a portfolio together with its estimated annualized "
        "return, volatility, and Sharpe ratio (computed from the pool's own historical daily "
        "returns under the resulting fixed weights).",
    )

    add_subheading(doc, "C. LSTM Price Forecaster")
    add_body(
        doc,
        "For an individual ticker, closing prices are min-max scaled and split "
        "chronologically 80/20 into train/test. A single-layer LSTM (PyTorch) with a linear "
        "head is trained to predict the next day's scaled close from the preceding "
        "seq_len days, evaluated on the held-out 20% via RMSE/MAE after inverse-scaling, and "
        "then used to recursively forecast forecast_days trading days ahead (each prediction "
        "is fed back in as the newest point in the sliding window).",
    )

    # ---------------- V. EVALUATION ----------------
    add_heading(doc, "V", "Evaluation")
    add_body(
        doc,
        "This section reports a pilot run exercising the full pipeline end to end on live "
        "data; it is intended to validate correctness and illustrate the outputs, not as the "
        "final evaluation. The pool comprised ten large-capitalization tickers (AAPL, MSFT, "
        "GOOGL, AMZN, NVDA, META, JPM, XOM, JNJ, PG) with two years of daily history imported "
        "from Yahoo Finance. PPO was trained for 3,000 timesteps with risk_aversion = 1.0 "
        "and a 30-day window -- a small budget chosen for a fast pilot run rather than a "
        "converged policy.",
    )
    add_table(
        doc,
        ["Ticker", "Weight"],
        [
            ["XOM", "10.62%"], ["JPM", "10.53%"], ["JNJ", "10.40%"], ["AAPL", "10.06%"],
            ["NVDA", "10.31%"], ["PG", "9.92%"], ["AMZN", "9.72%"], ["GOOGL", "9.57%"],
            ["META", "9.54%"], ["MSFT", "9.33%"],
        ],
        "TABLE I. Pilot PPO-recommended allocation (annualized return 23.2%, "
        "volatility 12.4%, Sharpe ratio 1.88).",
    )
    add_body(
        doc,
        "The near-uniform weights in Table I are expected at this training budget: with "
        "only 3,000 timesteps the policy has barely moved from its randomly-initialized "
        "starting point, and the resulting metrics mostly reflect the pool's own "
        "diversification rather than a converged, differentiated allocation. This is "
        "presented as a correctness check of the pipeline (data to environment to trained "
        "policy to saved portfolio) rather than a claim about the RL formulation's "
        "investment merit; Section VI outlines the larger training budget and baseline "
        "comparison needed to evaluate that.",
    )
    add_body(
        doc,
        "The LSTM forecaster was similarly pilot-tested on AAPL and GOOGL with a reduced "
        "budget (10-15 epochs). Held-out RMSE was approximately $114 (AAPL) and $127 "
        "(GOOGL) against prices in the $190-$330 range -- a poor fit, consistent with [4]'s "
        "observation that direct price-level regression is a weak formulation at low "
        "training budgets; the model was, in effect, still learning to track the recent mean "
        "rather than genuine dynamics. Full-scale training (more epochs, and potentially "
        "return-based rather than price-level targets) is planned before drawing any "
        "forecasting conclusions.",
    )

    # ---------------- VI. CONCLUSION ----------------
    add_heading(doc, "VI", "Conclusion and Future Work")
    add_body(
        doc,
        "This paper presented the design and a working implementation of a data-intensive "
        "platform that unifies fundamental screening, candidate-pool construction, "
        "reinforcement-learning-based portfolio allocation, and per-asset price forecasting "
        "over the S&P 500 universe, built on ArangoDB, Celery/Redis, Flask, and React/"
        "Redux-Saga with live WebSocket progress reporting. The pilot run in Section V "
        "validated the pipeline end to end on live market data.",
    )
    add_body(
        doc,
        "The planned full evaluation (course Stage 4) will: (1) train PPO for substantially "
        "more timesteps across pools of varying size, sector composition, and risk_aversion "
        "settings; (2) benchmark the resulting portfolios against equal-weight and "
        "mean-variance (Markowitz [1]) baselines on a held-out time period, using annualized "
        "return, volatility, Sharpe ratio, and maximum drawdown; (3) train the LSTM "
        "forecaster to convergence and compare price-level versus return-based target "
        "formulations, following the direction suggested by [4]; and (4) run the full "
        "503-ticker import to evaluate the screening layer at full S&P 500 scale.",
    )

    # ---------------- REFERENCES ----------------
    add_heading(doc, "", "References")
    references = [
        "H. M. Markowitz, \"Portfolio Selection,\" The Journal of Finance, vol. 7, no. 1, pp. 77-91, 1952.",
        "Z. Jiang, D. Xu, and J. Liang, \"A Deep Reinforcement Learning Framework for the Financial Portfolio Management Problem,\" arXiv preprint arXiv:1706.10059, 2017.",
        "J. Schulman, F. Wolski, P. Dhariwal, A. Radford, and O. Klimov, \"Proximal Policy Optimization Algorithms,\" arXiv preprint arXiv:1707.06347, 2017.",
        "T. Fischer and C. Krauss, \"Deep learning with long short-term memory networks for financial market predictions,\" European Journal of Operational Research, vol. 270, no. 2, pp. 654-669, 2018.",
        "M. Kleppmann, Designing Data-Intensive Applications. Sebastopol, CA, USA: O'Reilly Media, 2017.",
        "K.-C. Li, A. Cuzzocrea, L. T. Yang, and H. Jiang, Eds., Big Data: Algorithms, Analytics, and Applications. Boca Raton, FL, USA: CRC Press, 2015.",
        "A. Raffin, A. Hill, A. Gleave, A. Kanervisto, M. Ernestus, and N. Dormann, \"Stable-Baselines3: Reliable Reinforcement Learning Implementations,\" Journal of Machine Learning Research, vol. 22, no. 268, pp. 1-8, 2021.",
    ]
    for i, ref in enumerate(references, start=1):
        add_reference(doc, i, ref)

    doc.save("ITEC5205_ResearchPaper.docx")
    print("Saved ITEC5205_ResearchPaper.docx")


if __name__ == "__main__":
    main()
