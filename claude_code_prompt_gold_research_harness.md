# Prompt for Claude Code — XAUUSD Research Harness

Copy everything below the line into Claude Code.

---

## Project

Build a Python research harness for a machine-learning gold (XAUUSD) trading strategy.
Data comes from a local MetaTrader 5 terminal, with an optional external history backfill.
The deliverable is a **validation-first** codebase: the harness must make it hard to fool
myself with an overfit backtest. Execution goes to MT5 later — not part of this build.

I am a solo retail trader. Prioritise correctness and clarity over cleverness or breadth.

## Environment

- Python 3.11+, Windows (MT5 terminal runs locally)
- Allowed deps: `MetaTrader5`, `pandas`, `numpy`, `polars` (optional), `lightgbm`,
  `scikit-learn`, `pyarrow`, `matplotlib`, `pyyaml`, `pytest`
- No cloud services, no paid data vendors, no web frameworks
- Store all data as Parquet under `data/`

## Repository layout

Create this structure:

```
gold_research/
  config/
    config.yaml            # all tunables live here, no magic numbers in code
  src/
    data/
      mt5_loader.py        # pull bars + ticks from MT5
      external_loader.py   # load/normalise Dukascopy-style CSV history
      calendar.py          # server-time -> UTC, session tagging, gap handling
      stitch.py            # join external history to broker feed
    features/
      builders.py          # stationary feature engineering
    labels/
      triple_barrier.py    # TP / SL / time-limit labelling
    validation/
      purged_cv.py         # purged walk-forward with embargo
      costs.py             # spread, commission, swap model
      metrics.py           # net Sharpe, max DD, turnover, hit rate, profit factor
    models/
      lgbm_model.py
      baseline_donchian.py # non-ML benchmark
    backtest/
      engine.py            # event-ordered, bar-close execution only
      report.py            # equity curve, drawdown, fold-by-fold table
  tests/
  scripts/
    run_backfill.py
    run_experiment.py
    log_ticks.py           # continuous live tick logger
  README.md
```

## Hard requirements — these are the point of the project

### 1. No look-ahead, enforced structurally
- Signals may only use data from **closed** bars. Entry executes at the open of bar `t+1`.
- Every scaler / encoder / transform fits **inside the training fold only**.
- Write a unit test that shifts the entire feature matrix forward by one bar and asserts
  that performance collapses. If it doesn't, there is leakage — fail loudly.

### 2. Purged walk-forward, never a random split
- Implement expanding-window walk-forward CV.
- **Purge** training samples whose label horizon overlaps the test window.
- Apply an **embargo** gap (configurable, default 1% of sample count) after each test fold.
- Report metrics per fold, not just aggregated — I want to see stability across regimes.

### 3. Triple-barrier labelling
- Upper barrier, lower barrier, vertical (time) barrier.
- Barriers scaled by rolling ATR or realised volatility, not fixed pips.
- Record the realised return and the time-to-barrier for every sample.
- Support meta-labelling (side from baseline, size/filter from the model) as an option.

### 4. Costs are non-optional
- Subtract, per trade: spread at entry (from tick data where available, else a configured
  floor), commission per lot, and swap for positions held past broker rollover.
- Make spread **time-varying** — it must widen around scheduled events and rollover.
- Every reported metric is net. Do not print a gross number anywhere.

### 5. MT5 data hygiene
- Detect and record the broker **server timezone and DST behaviour**; convert everything to
  UTC internally. Do not hardcode GMT+2/+3 — infer it and assert it.
- MT5 OHLC bars are **bid**. Reconstruct ask using tick data or a configured spread model,
  and apply the correct side to every fill.
- Flag and handle: weekend gaps, holiday half-sessions, zero-volume bars, duplicate
  timestamps, and the Sunday open gap.
- Log how far back the broker's M1 history actually goes and warn if under 5 years.

### 6. Stationary features only
Raw price levels must never be a model input. Build:
- log returns over multiple horizons
- ATR-normalised distance from several moving averages
- realised volatility and vol-of-vol
- range/ATR ratios, rolling z-scores
- session flags (Asia / London / NY), day-of-week, hours-to-rollover
- optional exogenous columns loaded from CSV (DXY, US 10Y real yield) with a
  strict as-of join that never peeks forward

Keep the default feature set to roughly 15–30 features. Do not add more.

### 7. Baseline and kill rule
- Implement a plain Donchian channel breakout with ATR stops and 1% fixed-fractional
  sizing as the benchmark.
- `run_experiment.py` must print an ML-vs-baseline comparison table on **net** metrics
  and state plainly whether the model clears a configurable outperformance threshold.
- If it doesn't clear it, say so in the output. No hedging language.

### 8. Risk module
- Fixed-fractional sizing, default 0.5% equity risk per trade.
- Daily loss limit and max-drawdown kill-switch that flattens and halts.
- These are constants in config, explicitly marked as **not optimisable parameters**.

## Explicitly do NOT

- Do not implement live order placement
- Do not add deep learning (no LSTM/transformer) — LightGBM only
- Do not run brute-force grid or genetic optimisation over hundreds of parameter sets
- Do not report accuracy or AUC as a headline metric
- Do not silently fill missing data; raise or flag it

## Build order

Work in these steps and pause after each for my review:

1. Repo skeleton, `config.yaml`, README
2. MT5 loader + timezone/calendar handling + data quality report
3. External history loader and stitching
4. Triple-barrier labelling + tests
5. Purged walk-forward CV + leakage test
6. Cost model + metrics
7. Backtest engine + report
8. Donchian baseline
9. LightGBM model + end-to-end `run_experiment.py`
10. Tick logger script

## Style

- Type hints throughout, docstrings on public functions
- `pytest` tests for labelling, purging, cost application, and the leakage check
- Fail fast with clear exceptions; no silent `try/except pass`
- README explains how to run a full experiment in under 10 lines

Start with step 1 and show me the config schema before writing the rest.
