import hashlib
import html as html_std
import io
import json
import os
import re
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st

# ── Page config ──
st.set_page_config(
    page_title="LLM Portfolio Evaluation Dashboard",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Default workbook in the same folder as this script (no upload needed). Upload in the sidebar overrides this.
DEFAULT_EVAL_PACKAGE_FILENAMES = (
    "evaluation_package_all_2025_20260403_014832.xlsx",
    "evaluation_package_all_2025_20260331_174048 (1).xlsx",
    "evaluation_package_all_2025_20260331_174048.xlsx",
)


def _default_evaluation_package_path():
    base = Path(__file__).resolve().parent
    for name in DEFAULT_EVAL_PACKAGE_FILENAMES:
        p = base / name
        if p.is_file():
            return p
    return None


# ── Dark theme CSS ──
st.markdown("""
<style>
    .stApp { background-color: #0B0F13; }

    /* KPI cards */
    .kpi-card {
        background: linear-gradient(145deg, #141A22 0%, #111820 100%);
        border: 1px solid #1E2A3A; border-radius: 10px;
        padding: 18px 22px; text-align: center;
        transition: border-color 0.2s ease, transform 0.15s ease;
    }
    .kpi-card:hover { border-color: #2E4A6A; transform: translateY(-1px); }
    .kpi-label {
        font-size: 10px; color: #5E7082; text-transform: uppercase;
        letter-spacing: 1.4px; margin-bottom: 8px; font-weight: 600;
    }
    .kpi-value { font-size: 28px; font-weight: 700; line-height: 1.1; }
    .kpi-sub { font-size: 11px; color: #5E7082; margin-top: 6px; line-height: 1.4; }

    /* Insight cards */
    .insight-card {
        border-radius: 10px; padding: 16px 20px; margin-bottom: 12px;
        border-left: 4px solid; transition: background 0.2s ease;
    }
    .insight-title { font-weight: 700; font-size: 14px; margin-bottom: 6px; }
    .insight-body { font-size: 13px; color: #A0AEBB; line-height: 1.7; }

    /* Section headers */
    .section-header {
        font-size: 13px; font-weight: 700; color: #5E7082;
        text-transform: uppercase; letter-spacing: 2px;
        padding-bottom: 8px; margin-top: 24px; margin-bottom: 16px;
        border-bottom: 1px solid #1E2A3A;
    }

    /* Tab styling */
    div[data-testid="stTabs"] button {
        font-family: 'Inter', -apple-system, sans-serif !important;
        font-size: 13px !important; font-weight: 600 !important;
        letter-spacing: 0.3px !important;
    }
    div[data-testid="stTabs"] button[aria-selected="true"] {
        border-bottom-color: #4C9AFF !important;
    }

    /* Expanders */
    details[data-testid="stExpander"] summary {
        font-weight: 600 !important; font-size: 13px !important;
    }

    /* Metric badge for file status */
    .file-badge {
        background: #1A2E4A; border: 1px solid #2E4A6A; border-radius: 6px;
        padding: 8px 12px; font-size: 12px; color: #A0AEBB;
        margin-bottom: 8px; line-height: 1.5;
    }
    .file-badge strong { color: #E2E8F0; }
    .file-badge .accent { color: #4C9AFF; }
    .file-badge .green { color: #34D399; }

    /* Subtle horizontal rule */
    .soft-hr {
        border: none; border-top: 1px solid #1E2A3A;
        margin: 24px 0;
    }

    /* Traceability strip */
    .trace-strip {
        background: #111820; border: 1px solid #1E2A3A; border-radius: 8px;
        padding: 12px 16px; font-family: monospace; font-size: 11px;
        color: #A0AEBB; line-height: 1.7; margin-bottom: 12px;
    }
    .trace-strip strong { color: #E2E8F0; }
    .trace-strip .val { color: #4C9AFF; }

    /* Data tables */
    div[data-testid="stDataFrame"] {
        border: 1px solid #1E2A3A !important; border-radius: 8px !important;
    }

    /* Chat messages */
    div[data-testid="stChatMessage"] {
        border-radius: 10px !important;
    }

    /* Multiselect chips: extra vertical rhythm when many tags wrap (By Regime, etc.) */
    div[data-testid="stMultiSelect"] [data-baseweb="tag"] {
        margin: 4px 8px 10px 0 !important;
    }
    div[data-testid="stMultiSelect"] div[data-baseweb="select"] > div {
        padding-top: 6px !important;
        padding-bottom: 10px !important;
    }
    div[data-testid="stMultiSelect"] div[data-baseweb="value"] {
        row-gap: 10px !important;
        column-gap: 8px !important;
        flex-wrap: wrap !important;
        align-content: flex-start !important;
    }
</style>
""", unsafe_allow_html=True)

PLOT_LAYOUT = dict(
    template="plotly_dark",
    paper_bgcolor="#141A22",
    plot_bgcolor="#0F151C",
    font=dict(family="Inter, -apple-system, sans-serif", size=11, color="#A0AEBB"),
    margin=dict(l=48, r=24, t=48, b=40),
    legend=dict(font=dict(size=10), bgcolor="rgba(0,0,0,0)"),
    hoverlabel=dict(bgcolor="#1A2E4A", font_size=12, font_family="Inter, sans-serif"),
)
# Plotly default is straight segments between points ("linear"); spline reads smoother on period-ordered series.
SCATTER_LINE_SHAPE = "spline"
_GRID = dict(gridcolor="#1E2A3A", gridwidth=1, zeroline=False)


def _apply_grid(fig):
    """Apply subtle grid styling to both axes without overwriting explicit axis config."""
    fig.update_xaxes(**_GRID)
    fig.update_yaxes(**_GRID)
    return fig

GREEN = "#34D399"
RED = "#F87171"
AMBER = "#FBBF24"
ACCENT = "#4C9AFF"
CYAN = "#22D3EE"
PURPLE = "#A78BFA"
PINK = "#F472B6"
COLORS = [ACCENT, GREEN, AMBER, RED, PURPLE, CYAN, "#FB923C", "#818CF8", "#2DD4BF", "#E879F9"]

# Strategy color mapping (consistent across all charts)
STRATEGY_COLORS = {
    "gpt_retail": ACCENT,
    "gpt_advanced": "#FB923C",
    "mean_variance": PURPLE,
    "equal_weight": CYAN,
    "sixty_forty": "#5E7082",
    "index": AMBER,
    "GPT (Retail prompt)": ACCENT,
    "GPT (Advanced Prompting)": "#FB923C",
    "Mean-variance": PURPLE,
    "Equal weight (1/N)": CYAN,
    "60/40 (market-matched)": "#5E7082",
    "Market index (buy-and-hold)": AMBER,
    "fama_french": "#818CF8",
    "Fama-French": "#818CF8",
    "gpt_pooled_mean": "#38BDF8",
}

MARKET_LABELS = {"us": "S&P 500 (US)", "germany": "DAX 40 (Germany)", "japan": "Nikkei 225 (Japan)"}

# Benchmark overlays: (strategy_key, legend name, color, line dash) — use wherever GPT is shown
BENCHMARK_OVERLAY_SPECS = [
    ("index", "Market index", AMBER, "dash"),
    ("sixty_forty", "60/40", "#5E7082", "dot"),
    ("equal_weight", "Equal weight", CYAN, "dot"),
    ("mean_variance", "Mean-variance", PURPLE, "dash"),
    ("fama_french", "Fama-French", "#818CF8", "dot"),
]


def _strategy_paths_duplicates_gpt_median_overlay(strategy_key) -> bool:
    """Hide calc_strategy_paths rows that duplicate the trajectory-based GPT median + P10–P90 overlay.

    Exports use varying keys (``gpt_retail``, ``gpt_retrieval``, etc.); all are dropped when overlays exist.
    """
    s = str(strategy_key).strip().lower().replace(" ", "_").replace("-", "_")
    if s in ("gpt_retail", "gpt_advanced", "gpt_unknown", "gpt_retrieval", "gpt_rft"):
        return True
    if s.startswith("gpt_") and any(x in s for x in ("retail", "advanced", "retrieval", "rft", "unknown")):
        return True
    if "gpt" in s and any(x in s for x in ("retail", "advanced", "retrieval")):
        return True
    return False


# ── Helpers ──
def section_header(text):
    st.markdown(f'<div class="section-header">{text}</div>', unsafe_allow_html=True)


def soft_hr():
    st.markdown('<hr class="soft-hr">', unsafe_allow_html=True)


def kpi_card(label, value, color=ACCENT, sub=""):
    sub_html = f'<div class="kpi-sub">{sub}</div>' if sub else ""
    st.markdown(f"""
    <div class="kpi-card">
        <div class="kpi-label">{label}</div>
        <div class="kpi-value" style="color:{color}">{value}</div>
        {sub_html}
    </div>""", unsafe_allow_html=True)


def kpi_row(items, cols_per_row=None):
    """Render a row of KPI cards. items = list of (label, value, color[, sub])."""
    n = cols_per_row or len(items)
    cols = st.columns(n)
    for i, item in enumerate(items[:n]):
        label, value, color = item[0], item[1], item[2] if len(item) > 2 else ACCENT
        sub = item[3] if len(item) > 3 else ""
        with cols[i]:
            kpi_card(label, value, color, sub)


def insight_card(type_, title, body):
    colors = {"pos": GREEN, "neg": RED, "warn": AMBER, "info": ACCENT}
    bgs = {"pos": "#0F2922", "neg": "#2D1518", "warn": "#2D2410", "info": "#1A2E4A"}
    icons = {"pos": "▲", "neg": "▼", "warn": "⚠", "info": "◈"}
    c = colors.get(type_, ACCENT)
    bg = bgs.get(type_, "#1A2E4A")
    ic = icons.get(type_, "◈")
    st.markdown(f"""
    <div class="insight-card" style="background:{bg}; border-left-color:{c};">
        <div class="insight-title" style="color:#E2E8F0;">{ic} {title}</div>
        <div class="insight-body">{body}</div>
    </div>""", unsafe_allow_html=True)


def _chart_key(prefix: str, *parts) -> str:
    """Generate a unique, deterministic key for st.plotly_chart from context parts."""
    slug = "_".join(str(p).replace(" ", "_")[:20] for p in parts if p is not None)
    return f"{prefix}_{slug}"


def fmt(v, d=1):
    if v is None or pd.isna(v):
        return "—"
    return f"{v:.{d}f}"


def fmtp(v, d=1):
    if v is None or pd.isna(v):
        return "—"
    return f"{v:.{d}f}%"


def sharpe_color(v):
    if v is None or pd.isna(v):
        return "#5E7082"
    if v > 1.0:
        return GREEN
    if v > 0.5:
        return AMBER
    return RED


def sig_color(p):
    if p is None or pd.isna(p):
        return "#5E7082"
    return GREEN if p < 0.05 else RED


def _env_key(*names: str) -> str:
    for n in names:
        v = os.environ.get(n, "").strip()
        if v:
            return v
    return ""


def _secrets_key(*toml_keys: str) -> str:
    try:
        sec = st.secrets
        for k in toml_keys:
            if k in sec:
                v = str(sec[k]).strip()
                if v:
                    return v
    except FileNotFoundError:
        pass
    except Exception:
        pass
    return ""


def _local_openai_key_path() -> Path:
    return Path(__file__).resolve().parent / ".openai_api_key"


def _read_local_openai_key() -> str:
    p = _local_openai_key_path()
    try:
        if p.is_file():
            return p.read_text(encoding="utf-8").strip()
    except OSError:
        pass
    return ""


def _write_local_openai_key(key: str) -> None:
    p = _local_openai_key_path()
    p.write_text(key.strip(), encoding="utf-8")
    try:
        os.chmod(p, 0o600)
    except OSError:
        pass


def _persisted_openai_key() -> str:
    return (
        _env_key("OPENAI_API_KEY", "STREAMLIT_OPENAI_API_KEY")
        or _secrets_key("OPENAI_API_KEY", "openai_api_key")
        or _read_local_openai_key()
    )


def _openai_key_source_label() -> str:
    if _env_key("OPENAI_API_KEY", "STREAMLIT_OPENAI_API_KEY"):
        return "environment variable"
    if _secrets_key("OPENAI_API_KEY", "openai_api_key"):
        return "`.streamlit/secrets.toml`"
    if _read_local_openai_key():
        return "local file `.openai_api_key`"
    return ""


# ══════════════════════════════════════════════════════════════
# DATA LOADING
# ══════════════════════════════════════════════════════════════

def _match_excel_sheet(xls, *candidates):
    """Resolve workbook sheet name case-insensitively; allow minor punctuation variants."""
    if xls is None or not candidates:
        return None

    def _norm(s):
        t = str(s).strip().lower()
        for a, b in [("–", "-"), ("—", "-"), ("  ", " ")]:
            t = t.replace(a, b)
        return " ".join(t.split())

    actual_names = list(xls.sheet_names)
    by_norm = {_norm(n): n for n in actual_names}
    for cand in candidates:
        if not cand:
            continue
        k = _norm(cand)
        if k in by_norm:
            return by_norm[k]
    # Slash vs hyphen in benchmark tab names
    for cand in candidates:
        if not cand:
            continue
        variants = {_norm(cand), _norm(cand.replace("/", "-")), _norm(cand.replace("-", "/"))}
        for v in variants:
            if v in by_norm:
                return by_norm[v]
    return None


def _canonical_market_value(v):
    """Map region labels to the same codes used in Portfolio runs (us, germany, japan)."""
    s = str(v).strip().lower().replace(" ", "_").replace("-", "_")
    if s in ("us", "usa", "united_states", "u.s.", "u.s.a.", "sp500", "s&p", "snp", "nyse"):
        return "us"
    if s in ("germany", "de", "dax", "deu", "ger", "eu_de"):
        return "germany"
    if s in ("japan", "jp", "jpn", "nikkei", "tyo", "jpx"):
        return "japan"
    return str(v).strip().lower()


def _merge_strategy_cells_with_regime(strat_cells: pd.DataFrame, rg_ref_tab: pd.DataFrame) -> pd.DataFrame:
    """Join strategy_cells Sharpe rows to regime labels on (market, period)."""
    if (
        strat_cells is None
        or rg_ref_tab is None
        or len(strat_cells) == 0
        or len(rg_ref_tab) == 0
        or "sharpe" not in strat_cells.columns
        or not all(c in rg_ref_tab.columns for c in ("market", "period", "Market_Label"))
    ):
        return pd.DataFrame()
    _rlk = rg_ref_tab[["market", "period", "Market_Label", "Vol_Label", "Rate_Label"]].copy()
    _rlk["period"] = _rlk["period"].map(lambda x: str(x).strip() if pd.notna(x) else x)
    _rlk["market"] = _rlk["market"].map(_canonical_market_value)
    sc = strat_cells.copy()
    sc["period"] = sc["period"].map(lambda x: str(x).strip() if pd.notna(x) else x)
    if "market" in sc.columns:
        sc["market"] = sc["market"].map(_canonical_market_value)
    out = sc.merge(_rlk, on=["market", "period"], how="inner", suffixes=("", "_r"))
    return out.drop(columns=["Market_Label_r"], errors="ignore")


def _filter_regime_slice(
    df: pd.DataFrame,
    sel_mkts,
    sel_periods,
    sel_trend,
    sel_vol,
    sel_rate,
) -> pd.DataFrame:
    """Apply market / period / trend / vol / rate selections (GPT runs or merged benchmark rows)."""
    if df is None or len(df) == 0:
        return df if df is not None else pd.DataFrame()
    out = df.copy()
    if sel_mkts is not None and len(sel_mkts) > 0 and "market" in out.columns:
        out = out[out["market"].isin(sel_mkts)]
    if sel_periods is not None and len(sel_periods) > 0 and "period" in out.columns:
        out = out[out["period"].isin(sel_periods)]
    if sel_trend is not None and len(sel_trend) > 0 and "Market_Label" in out.columns:
        out = out[out["Market_Label"].isin(sel_trend)]
    if sel_vol is not None and len(sel_vol) > 0 and "Vol_Label" in out.columns:
        out = out[out["Vol_Label"].isin(sel_vol)]
    if sel_rate is not None and len(sel_rate) > 0 and "Rate_Label" in out.columns:
        out = out[out["Rate_Label"].isin(sel_rate)]
    return out


def _apply_regime_prompt_mode(gpt_df: pd.DataFrame, prompt_mode: str) -> pd.DataFrame:
    if gpt_df is None or len(gpt_df) == 0:
        return gpt_df if gpt_df is not None else pd.DataFrame()
    if prompt_mode == "Retail only":
        return gpt_df[gpt_df["prompt_type"].astype(str).str.lower() == "retail"].copy()
    if prompt_mode == "Advanced only":
        return gpt_df[gpt_df["prompt_type"].astype(str).str.lower() == "advanced"].copy()
    return gpt_df.copy()


# Canonical regime axes: charts always show every bucket (empty / NaN when no observations).
FULL_TREND_REGIME_ORDER = ("Bull", "Flat", "Bear")
FULL_VOL_REGIME_ORDER = ("Low", "Elevated", "High")
FULL_RATE_REGIME_ORDER = ("Easing", "Stable", "Tightening")


def _regime_axis_orders(gpt_f: pd.DataFrame):
    def _axis_full_core(vals, core: tuple):
        """Always return all `core` labels in order, then any other labels present in data."""
        core_list = list(core)
        if vals is None or len(vals) == 0:
            return core_list
        seen = [str(x) for x in sorted(vals.unique(), key=str) if str(x) not in ("nan", "NaT")]
        out = list(core_list)
        for x in seen:
            if x not in out:
                out.append(x)
        return out

    if gpt_f is None or len(gpt_f) == 0:
        return list(FULL_TREND_REGIME_ORDER), list(FULL_VOL_REGIME_ORDER), list(FULL_RATE_REGIME_ORDER)
    to = _axis_full_core(
        gpt_f["Market_Label"] if "Market_Label" in gpt_f.columns else pd.Series(dtype=object),
        FULL_TREND_REGIME_ORDER,
    )
    vo = _axis_full_core(
        gpt_f["Vol_Label"] if "Vol_Label" in gpt_f.columns else pd.Series(dtype=object),
        FULL_VOL_REGIME_ORDER,
    )
    ro = _axis_full_core(
        gpt_f["Rate_Label"] if "Rate_Label" in gpt_f.columns else pd.Series(dtype=object),
        FULL_RATE_REGIME_ORDER,
    )
    return to, vo, ro


def _normalize_benchmark_geo_columns(df):
    """Align market/period strings in benchmark tabs with Portfolio runs."""
    if df is None or len(df) == 0:
        return df
    out = df.copy()
    if "market" in out.columns:
        out["market"] = out["market"].map(_canonical_market_value)
    if "period" in out.columns:
        out["period"] = out["period"].map(lambda x: str(x).strip() if pd.notna(x) else x)
    return out


def _ensure_benchmark_standard_columns(df):
    """Map alternate benchmark column names to benchmark_return / benchmark_sharpe."""
    if df is None or len(df) == 0:
        return df
    out = df.copy()
    if "benchmark_return" not in out.columns:
        for alt in ("period_return", "return", "benchmark_period_return", "semi_annual_return", "strategy_return"):
            if alt in out.columns:
                out["benchmark_return"] = pd.to_numeric(out[alt], errors="coerce")
                break
    if "benchmark_sharpe" not in out.columns:
        for alt in ("sharpe_ratio", "sharpe", "sortino_ratio"):
            if alt in out.columns:
                out["benchmark_sharpe"] = pd.to_numeric(out[alt], errors="coerce")
                break
    return out


def _ensure_net_return_column(df):
    if df is None or len(df) == 0:
        return df
    if "net_return" not in df.columns and "period_return_net" in df.columns:
        df = df.copy()
        df["net_return"] = df["period_return_net"]
    return df


def _normalize_portfolio_runs_sheet(df):
    """Align alternate Excel headers and market codes with what the dashboard expects."""
    if df is None or len(df) == 0:
        return df
    out = df.copy()
    out.columns = [str(c).strip() for c in out.columns]

    def nk(c):
        return "".join(ch if ch.isalnum() else "_" for ch in str(c).lower()).strip("_")

    col_by_norm = {nk(c): c for c in out.columns}
    pairs = [
        ("market", ["market", "mkt", "region", "country"]),
        ("period", ["period", "half", "time_period", "evaluation_period", "semester"]),
        ("prompt_type", ["prompt_type", "prompt", "prompting", "prompt_kind", "prompt_style"]),
        ("holding_ticker", ["holding_ticker", "ticker", "symbol", "instrument", "instrument_ticker", "stock_ticker", "asset"]),
        ("holding_name", ["holding_name", "name", "security_name", "company_name"]),
        ("holding_weight", ["holding_weight", "weight", "allocation", "pct_weight", "target_weight", "position_weight"]),
        ("holding_rank", ["holding_rank", "rank", "position_rank"]),
        ("holding_sector", ["holding_sector", "sector", "gics_sector"]),
        ("holding_asset_class", ["holding_asset_class", "asset_class", "assetclass"]),
        ("sharpe_ratio", ["sharpe_ratio", "sharpe"]),
        ("period_return_net", ["period_return_net", "period_net_return", "net_period_return"]),
        ("net_return", ["net_return"]),
        ("period_return", ["period_return", "gross_period_return", "semi_annual_return"]),
        ("run_id", ["run_id", "run_number", "run_num"]),
        ("trajectory_id", ["trajectory_id", "trajectory", "traj_id", "traj"]),
        ("portfolio_key", ["portfolio_key", "portfolio_id", "run_key", "experiment_run_key"]),
        ("experiment_id", ["experiment_id", "experiment", "batch_id"]),
        ("hhi", ["hhi", "herfindahl", "herfindahl_index"]),
        ("effective_n_holdings", ["effective_n_holdings", "effective_n", "eff_n_holdings", "effective_holdings"]),
        ("n_holdings", ["n_holdings", "num_holdings", "holdings_count"]),
        ("turnover", ["turnover", "portfolio_turnover"]),
        ("post_loss_rebalance", ["post_loss_rebalance", "post_loss_reaction", "post_loss_rebalancing"]),
        ("model", ["model", "llm_model", "gpt_model"]),
        ("valid", ["valid", "is_valid", "passes_validation"]),
        ("reasoning_summary", ["reasoning_summary", "reasoning", "rationale_summary", "decision_summary", "rationale"]),
    ]
    renames = {}
    for std, alts in pairs:
        if std in out.columns:
            continue
        for a in alts:
            key = nk(a)
            if key in col_by_norm:
                old = col_by_norm[key]
                if old not in renames:
                    renames[old] = std
                break
    if renames:
        out = out.rename(columns=renames)
        col_by_norm = {nk(c): c for c in out.columns}

    out = _ensure_net_return_column(out)
    if "net_return" not in out.columns and "period_return_net" not in out.columns and "period_return" in out.columns:
        out = out.copy()
        out["net_return"] = pd.to_numeric(out["period_return"], errors="coerce")

    if "market" in out.columns:
        out["market"] = out["market"].map(_canonical_market_value)

    if "prompt_type" in out.columns:
        out["prompt_type"] = out["prompt_type"].astype(str).str.strip().str.lower()

    # New export: trend / vol / rate regimes live on each row (integrated in Excel).
    if "Market_Label" not in out.columns and "market_regime_label" in out.columns:
        out["Market_Label"] = out["market_regime_label"]
    if "Vol_Label" not in out.columns and "vol_regime_label" in out.columns:
        out["Vol_Label"] = out["vol_regime_label"]
    if "Rate_Label" not in out.columns and "rate_regime_label" in out.columns:
        out["Rate_Label"] = out["rate_regime_label"]

    return out


def _normalize_postloss_sheet(df):
    """Map alternate Excel headers for post-loss rebalance metrics to canonical names used by charts."""
    if df is None or len(df) == 0:
        return pd.DataFrame()
    out = df.copy()
    out.columns = [str(c).strip() for c in out.columns]

    def nk(c):
        return "".join(ch if ch.isalnum() else "_" for ch in str(c).lower()).strip("_")

    col_by_norm = {nk(c): c for c in out.columns}
    pairs = [
        ("prompt_type", ["prompt_type", "prompt", "prompt_kind", "prompt_style"]),
        (
            "avg_turnover_after_loss",
            [
                "avg_turnover_after_loss",
                "average_turnover_after_loss",
                "mean_turnover_after_loss",
                "turnover_after_loss",
                "avg_turnover_post_loss",
            ],
        ),
        (
            "avg_turnover_after_non_loss",
            [
                "avg_turnover_after_non_loss",
                "average_turnover_after_non_loss",
                "mean_turnover_after_non_loss",
                "avg_turnover_after_gain",
                "turnover_after_gain",
                "turnover_after_non_loss",
            ],
        ),
        (
            "pct_rebalances_after_loss",
            [
                "pct_rebalances_after_loss",
                "pct_rebalance_after_loss",
                "fraction_rebalances_after_loss",
                "rebalance_rate_after_loss",
                "pct_rebalances_following_loss",
            ],
        ),
    ]
    renames = {}
    for std, alts in pairs:
        if std in out.columns:
            continue
        for a in alts:
            key = nk(a)
            if key in col_by_norm:
                old = col_by_norm[key]
                if old not in renames:
                    renames[old] = std
                break
    if renames:
        out = out.rename(columns=renames)
    if "prompt_type" in out.columns:
        out["prompt_type"] = out["prompt_type"].astype(str).str.strip().str.lower()
    for c in ("avg_turnover_after_loss", "avg_turnover_after_non_loss", "pct_rebalances_after_loss"):
        if c in out.columns:
            out[c] = pd.to_numeric(out[c], errors="coerce")
    return out


def _normalize_holding_column_names(df):
    """Rename common price/data column variants to standard holding_* names."""
    renames = {}
    for target, candidates in [
        ("holding_entry_price", ["entry_price", "price_bought", "buy_price",
                                  "price_at_entry", "purchase_price", "cost_basis", "open_price"]),
        ("holding_current_price", ["current_price", "price_now", "close_price",
                                    "last_price", "market_price", "end_price", "price_at_end"]),
        ("holding_return", ["holding_return", "stock_return", "asset_return"]),
    ]:
        if target not in df.columns:
            for cand in candidates:
                if cand in df.columns:
                    renames[cand] = target
                    break
    if renames:
        df = df.rename(columns=renames)
    return df


def _first_non_null(series):
    """First non-missing value in a group (portfolio metrics often sit on one holding row, not the first)."""
    sn = pd.to_numeric(series, errors="coerce")
    if sn.notna().any():
        return sn.dropna().iloc[0]
    for v in series:
        if pd.notna(v) and not (isinstance(v, str) and not str(v).strip()):
            return v
    return np.nan


def _canonical_period_key(val):
    """Single string key per half-year so '2022H2', '2022 H2', '2022h2' collapse in groupby (avoids duplicate x in charts)."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return ""
    s = str(val).strip()
    if not s or s.lower() == "nan":
        return ""
    s = re.sub(r"[\s\u00a0\u200b\u200c\u200d\ufeff]+", "", s)
    return s.upper()


def _preferred_run_identifier_column(columns):
    """Best column to identify one portfolio path for holdings and Run Explorer.

    ``run_id`` is often 1…N **reused** for each (market × prompt); ``trajectory_id`` / ``portfolio_key`` are unique.
    """
    if columns is None:
        return None
    for c in ("trajectory_id", "portfolio_key", "run_id", "portfolio_id"):
        if c in columns:
            return c
    return None


def _post_loss_flag_series(s: pd.Series) -> pd.Series:
    """Parse ``post_loss_rebalance`` / ``post_loss_reaction`` style flags from Portfolio runs exports."""
    if s is None or len(s) == 0:
        return pd.Series(dtype=bool)
    if getattr(s.dtype, "name", "") == "bool":
        return s.fillna(False)
    out = pd.Series(False, index=s.index)
    sn = pd.to_numeric(s, errors="coerce")
    out = out | (sn == 1)
    st = s.astype(str).str.strip().str.lower()
    out = out | st.isin(["true", "1", "yes", "y", "t"])
    try:
        out = out | (s == True)  # noqa: E712
    except (ValueError, TypeError):
        pass
    return out.fillna(False)


def compute_post_loss_analysis_from_runs(runs_df: pd.DataFrame):
    """Summarize post-loss reaction from **Portfolio runs** (evaluation package).

    When the sheet includes **``post_loss_rebalance``** (or ``post_loss_reaction``) with at least one
    ``True`` row, **after-loss periods** are those rows — the pipeline’s definition of a post-loss
    rebalance (e.g. ``evaluation_package_all_2025_*.xlsx``). Otherwise **after-loss** rows are
    **inferred**: the period immediately following a negative return on the same trajectory
    (``period`` sort order). ``retail`` / ``advanced`` only when ``prompt_type`` is present.
    """
    if runs_df is None or len(runs_df) == 0:
        return None
    id_col = _preferred_run_identifier_column(runs_df.columns)
    ret_col = next((c for c in ["net_return", "period_return_net", "period_return"] if c in runs_df.columns), None)
    if not id_col or not ret_col or "period" not in runs_df.columns:
        return None
    has_prompt = "prompt_type" in runs_df.columns
    if has_prompt:
        _pt = runs_df["prompt_type"].astype(str).str.strip().str.lower()
        gpt_only = runs_df[_pt.isin(["retail", "advanced"])].copy()
    else:
        gpt_only = runs_df.copy()
    if len(gpt_only) == 0:
        return None

    flag_col_used = None
    explicit_mask = None
    for cand in ("post_loss_rebalance", "post_loss_reaction", "post_loss_rebalancing"):
        if cand not in gpt_only.columns:
            continue
        em = _post_loss_flag_series(gpt_only[cand])
        if em.any():
            explicit_mask = em
            flag_col_used = cand
            break

    loss_rows = []
    after_loss_rows = []
    keys_after = set()
    source = ""

    if explicit_mask is not None:
        ret_all = pd.to_numeric(gpt_only[ret_col], errors="coerce")
        n_loss_periods = int((ret_all < 0).sum())
        al_df = gpt_only.loc[explicit_mask].copy()
        for _, r in al_df.iterrows():
            keys_after.add((
                r.get(id_col),
                r.get("period"),
                r.get("market") if "market" in gpt_only.columns else None,
            ))
        source = f"Portfolio runs column `{flag_col_used}` (evaluation package)"
    else:
        for traj_id in gpt_only[id_col].dropna().unique():
            traj_data = gpt_only[gpt_only[id_col] == traj_id].sort_values("period")
            prev_ret = None
            for _, row in traj_data.iterrows():
                cur_ret = pd.to_numeric(row.get(ret_col, np.nan), errors="coerce")
                if prev_ret is not None and pd.notna(prev_ret) and float(prev_ret) < 0:
                    after_loss_rows.append(row)
                    keys_after.add((row.get(id_col), row.get("period"), row.get("market") if "market" in row.index else None))
                if pd.notna(cur_ret) and float(cur_ret) < 0:
                    loss_rows.append(row)
                prev_ret = cur_ret
        al_df = pd.DataFrame(after_loss_rows) if after_loss_rows else pd.DataFrame()
        n_loss_periods = len(loss_rows)
        source = "Inferred: first period after a negative return (same trajectory)"

    if explicit_mask is None:
        n_after_loss = len(after_loss_rows)
    else:
        n_after_loss = len(al_df)
    recovery_pct = np.nan
    after_loss_mean = np.nan
    if len(al_df) > 0 and ret_col in al_df.columns:
        al_ret = pd.to_numeric(al_df[ret_col], errors="coerce").dropna()
        if len(al_ret) > 0:
            recovery_pct = float((al_ret > 0).sum() / len(al_ret) * 100)
            after_loss_mean = float(al_ret.mean())

    hhi_after = hhi_other = hhi_diff = np.nan
    if "hhi" in gpt_only.columns and len(keys_after) > 0:

        def _row_after_key(r):
            return (r.get(id_col), r.get("period"), r.get("market") if "market" in gpt_only.columns else None)

        mask = gpt_only.apply(lambda r: _row_after_key(r) in keys_after, axis=1)
        ha = pd.to_numeric(gpt_only.loc[mask, "hhi"], errors="coerce").dropna()
        ho = pd.to_numeric(gpt_only.loc[~mask, "hhi"], errors="coerce").dropna()
        if len(ha) > 0:
            hhi_after = float(ha.mean())
        if len(ho) > 0:
            hhi_other = float(ho.mean())
        if pd.notna(hhi_after) and pd.notna(hhi_other):
            hhi_diff = hhi_after - hhi_other

    by_prompt = []
    if has_prompt and len(al_df) > 0 and "prompt_type" in al_df.columns:
        al_df = al_df.copy()
        al_df["_pt"] = al_df["prompt_type"].astype(str).str.strip().str.lower()
        for pt in ["retail", "advanced"]:
            pt_sub = al_df[al_df["_pt"] == pt]
            if len(pt_sub) == 0:
                continue
            pt_ret = pd.to_numeric(pt_sub[ret_col], errors="coerce").dropna()
            rec = float((pt_ret > 0).sum() / len(pt_ret) * 100) if len(pt_ret) > 0 else np.nan
            by_prompt.append({
                "Prompt": pt.title(),
                "After-loss periods": len(pt_sub),
                "Recovery %": rec,
                "Mean return": float(pt_ret.mean()) if len(pt_ret) > 0 else np.nan,
            })

    _want_cols = [id_col, "market", "period", "prompt_type", ret_col, "hhi", "turnover"]
    if flag_col_used:
        _want_cols.append(flag_col_used)
    show_cols = [c for c in _want_cols if c in al_df.columns]
    after_loss_table = al_df[show_cols].copy() if len(al_df) > 0 and show_cols else pd.DataFrame()

    after_loss_join = pd.DataFrame()
    if len(al_df) > 0 and id_col in al_df.columns:
        _jc = [id_col, "period"]
        if "market" in al_df.columns:
            _jc.append("market")
        after_loss_join = al_df[_jc].drop_duplicates().reset_index(drop=True)

    return {
        "id_col": id_col,
        "ret_col": ret_col,
        "n_loss_periods": n_loss_periods,
        "n_after_loss": n_after_loss,
        "recovery_pct": recovery_pct,
        "after_loss_mean_return": after_loss_mean,
        "hhi_after": hhi_after,
        "hhi_other": hhi_other,
        "hhi_diff": hhi_diff,
        "by_prompt": by_prompt,
        "after_loss_table": after_loss_table,
        "after_loss_join": after_loss_join,
        "has_prompt_scope": has_prompt,
        "source": source,
        "flag_column": flag_col_used,
    }


def derive_post_loss_rebalancing_from_runs(runs_df: pd.DataFrame):
    """Build Post-Loss Rebalancing-style chart data from **Portfolio runs** when the summary sheet is absent.

    Uses mean ``turnover`` on rows where ``post_loss_rebalance`` is true vs false, by ``prompt_type``.
    The percentage series is the share of rows (per prompt) flagged as post-loss rebalances.
    """
    if runs_df is None or len(runs_df) == 0:
        return None
    if "post_loss_rebalance" not in runs_df.columns or "turnover" not in runs_df.columns:
        return None
    if "prompt_type" not in runs_df.columns:
        return None
    g = runs_df[runs_df["prompt_type"].astype(str).str.strip().str.lower().isin(["retail", "advanced"])].copy()
    if len(g) == 0:
        return None
    if not _post_loss_flag_series(g["post_loss_rebalance"]).any():
        return None

    def _turnover_display_pct(m):
        if m is None or pd.isna(m):
            return 0.0
        x = float(m)
        return x * 100.0 if abs(x) <= 1.5 else x

    labels_pl, after_loss, after_gain, pct_after_loss = [], [], [], []
    for pt in ["retail", "advanced"]:
        sub = g[g["prompt_type"].astype(str).str.strip().str.lower() == pt]
        if len(sub) == 0:
            continue
        fls = _post_loss_flag_series(sub["post_loss_rebalance"])
        tv = pd.to_numeric(sub["turnover"], errors="coerce")
        m_al = tv[fls].mean()
        m_ag = tv[~fls].mean()
        labels_pl.append(pt.title())
        after_loss.append(_turnover_display_pct(m_al))
        after_gain.append(_turnover_display_pct(m_ag))
        pct_after_loss.append(float(fls.mean() * 100.0) if len(fls) else 0.0)

    return {"labels_pl": labels_pl, "after_loss": after_loss, "after_gain": after_gain, "pct_after_loss": pct_after_loss} if labels_pl else None


def _normalize_portfolio_runs(df):
    """Collapse holding-level rows to one row per (trajectory, period, market); keep long copy for holdings."""
    if df is None or len(df) == 0:
        return df, pd.DataFrame()

    # Synthesize trajectory_id when missing/all-NaN (new export format)
    if "trajectory_id" not in df.columns or df["trajectory_id"].isna().all():
        parts = []
        for c in ["market", "prompt_type", "run_id"]:
            if c in df.columns:
                parts.append(df[c].astype(str))
        if parts:
            df = df.copy()
            df["trajectory_id"] = parts[0]
            for p in parts[1:]:
                df["trajectory_id"] = df["trajectory_id"] + "_" + p
        elif "portfolio_key" in df.columns:
            df = df.copy()
            df["trajectory_id"] = df["portfolio_key"]

    key_cols = [c for c in ["trajectory_id", "run_id", "period", "market"] if c in df.columns]
    if len(key_cols) < 3 or "holding_ticker" not in df.columns:
        return _ensure_net_return_column(df.copy()), pd.DataFrame()
    grp_cols = [c for c in ["trajectory_id", "period", "market"] if c in df.columns]
    if len(grp_cols) < 3:
        return _ensure_net_return_column(df.copy()), pd.DataFrame()
    if df.groupby(grp_cols).size().max() <= 1:
        return _ensure_net_return_column(df.copy()), pd.DataFrame()
    long_df = _normalize_holding_column_names(df.copy())
    _metric_cols = [
        c for c in (
            "sharpe_ratio", "net_return", "period_return_net", "period_return",
            "hhi", "effective_n_holdings", "n_holdings", "turnover",
            "post_loss_rebalance",
            "expected_portfolio_return_6m", "forecast_bias", "forecast_abs_error",
        ) if c in df.columns
    ]
    _agg = {}
    for c in df.columns:
        if c in grp_cols:
            continue
        _agg[c] = _first_non_null if c in _metric_cols else "first"
    collapsed = df.groupby(grp_cols, as_index=False).agg(_agg)
    return _ensure_net_return_column(collapsed), long_df


def _pct_maybe_fraction(series):
    """If values look like 0–1 fractions, scale to 0–100 for dashboard charts."""
    s = pd.to_numeric(series, errors="coerce")
    if s.notna().any() and s.dropna().abs().max() <= 1.0:
        return s * 100.0
    return s


def _parse_overview_strategy_snapshot(xls):
    """Build calc_strategy_summary-shaped DataFrame from Overview sheet (new export format)."""
    _ov = _match_excel_sheet(xls, "Overview", "overview", "Executive summary", "Summary", "Package overview")
    if not _ov:
        return pd.DataFrame()
    raw = pd.read_excel(xls, _ov, header=None)
    hdr_idx = None
    for i in range(len(raw)):
        v0 = raw.iloc[i, 0]
        if pd.isna(v0):
            continue
        if str(v0).strip() != "Strategy":
            continue
        row_txt = " ".join(str(x) for x in raw.iloc[i].tolist() if pd.notna(x))
        if "Mean Sharpe" in row_txt and "Beat" in row_txt:
            hdr_idx = i
            break
    if hdr_idx is None:
        return pd.DataFrame()
    hdr = [str(c).strip() if pd.notna(c) else "" for c in raw.iloc[hdr_idx].tolist()]
    rows = []
    for j in range(hdr_idx + 1, len(raw)):
        r0 = raw.iloc[j, 0]
        if pd.isna(r0) or str(r0).strip() == "":
            break
        rows.append(raw.iloc[j].tolist())
    if not rows:
        return pd.DataFrame()
    n = min(len(hdr), max(len(r) for r in rows))
    tab = pd.DataFrame(rows, columns=hdr[:n])
    # Map flexible header names
    def pick(col_substr):
        for c in tab.columns:
            if col_substr.lower() in str(c).lower():
                return c
        return None

    strat_c = pick("strategy") if "Strategy" in tab.columns else tab.columns[0]
    out = pd.DataFrame()
    out["Strategy"] = tab[strat_c]
    ms = pick("mean sharpe")
    if ms:
        out["mean_sharpe"] = pd.to_numeric(tab[ms], errors="coerce")
    bi = pick("beat market index")
    if bi:
        out["pct_runs_beating_index_sharpe"] = _pct_maybe_fraction(tab[bi])
    b60 = pick("beat 60/40") or pick("beat sixty")
    if b60:
        out["pct_runs_beating_sixty_forty_sharpe"] = _pct_maybe_fraction(tab[b60])
    nr = pick("net return")
    if nr:
        out["net_return_mean"] = pd.to_numeric(tab[nr], errors="coerce")
    obs = pick("observations")
    if obs:
        out["n_observations"] = pd.to_numeric(tab[obs], errors="coerce").fillna(0).astype(int)
    sk_map = {
        "gpt (retail": "gpt_retail",
        "gpt (advanced": "gpt_advanced",
        "mean-variance": "mean_variance",
        "equal weight": "equal_weight",
        "60/40": "sixty_forty",
        "market index": "index",
        "fama-french": "fama_french",
        "fama french": "fama_french",
    }

    def strat_key(name):
        s = str(name).lower()
        for k, v in sk_map.items():
            if k in s:
                return v
        return ""

    out["strategy_key"] = out["Strategy"].apply(strat_key)
    return out


def _parse_overview_portfolio_behavior(xls):
    """Build Portfolio behavior-shaped DataFrame from Overview section (GPT rows only)."""
    _ov = _match_excel_sheet(xls, "Overview", "overview", "Executive summary", "Summary", "Package overview")
    if not _ov:
        return pd.DataFrame()
    raw = pd.read_excel(xls, _ov, header=None)
    hdr_rows = [i for i in range(len(raw)) if pd.notna(raw.iloc[i, 0]) and str(raw.iloc[i, 0]).strip() == "Strategy"]
    if len(hdr_rows) < 2:
        return pd.DataFrame()
    hdr_idx = hdr_rows[1]
    row_txt = " ".join(str(x) for x in raw.iloc[hdr_idx].tolist() if pd.notna(x))
    if "Mean HHI" not in row_txt:
        return pd.DataFrame()
    hdr = [str(c).strip() if pd.notna(c) else "" for c in raw.iloc[hdr_idx].tolist()]
    rows = []
    for j in range(hdr_idx + 1, len(raw)):
        r0 = raw.iloc[j, 0]
        if pd.isna(r0) or str(r0).strip() == "":
            break
        rows.append(raw.iloc[j].tolist())
    if not rows:
        return pd.DataFrame()
    n = min(len(hdr), max(len(r) for r in rows))
    tab = pd.DataFrame(rows, columns=hdr[:n])

    def col(*subs):
        for c in tab.columns:
            lc = str(c).lower()
            if all(s in lc for s in subs):
                return c
        return None

    out_rows = []
    for _, r in tab.iterrows():
        strat = str(r.iloc[0])
        if "gpt" not in strat.lower():
            continue
        pt = "retail" if "retail" in strat.lower() else "advanced" if "advanced" in strat.lower() else None
        if not pt:
            continue
        def g(name_subs, default=np.nan):
            c = col(*name_subs)
            if c is None or c not in r.index:
                return default
            return pd.to_numeric(r.get(c), errors="coerce")

        mt = col("mean", "turnover")
        mt_val = float(g(("mean", "turnover"))) if mt else np.nan
        out_rows.append({
            "prompt_type": pt,
            "mean_hhi": g(("mean", "hhi")),
            "mean_effective_n_holdings": g(("effective", "n")),
            "mean_turnover": mt_val,
            "median_turnover": mt_val,
            "mean_expected_portfolio_return_6m": g(("exp", "6m")) if col("exp", "6m") else g(("mean", "exp")),
            "mean_realized_net_return": g(("realized", "return")),
            "mean_forecast_bias": g(("forecast", "bias")),
            "mean_forecast_abs_error": g(("abs", "forecast")) if col("abs", "forecast") else g(("forecast", "error")),
        })
    return pd.DataFrame(out_rows)


def _synthesize_strategy_paths_from_benchmarks(xls):
    """Build calc_strategy_paths-like wide equity columns from per-benchmark sheets."""
    specs = [
        (("Index benchmark", "Index Benchmark", "index benchmark", "Market index benchmark"), "index"),
        (("60-40 benchmark", "60/40 benchmark", "60-40 Benchmark", "6040 benchmark"), "sixty_forty"),
        (("Equal weight benchmark", "Equal Weight benchmark", "equal_weight benchmark"), "equal_weight"),
        (("Mean-variance benchmark", "Mean variance benchmark", "Mean-Variance benchmark"), "mean_variance"),
        (("Fama-French benchmark", "Fama French benchmark", "Fama-French"), "fama_french"),
    ]
    chunks = []
    for cands, skey in specs:
        sn = _match_excel_sheet(xls, *cands)
        if not sn:
            continue
        df = _ensure_benchmark_standard_columns(_normalize_benchmark_geo_columns(pd.read_excel(xls, sn)))
        if "benchmark_return" not in df.columns or "market" not in df.columns or "period" not in df.columns:
            continue
        g = df.groupby(["market", "period"], as_index=False).first()
        g = g[["market", "period", "benchmark_return"]].copy()
        g["strategy_key"] = skey
        chunks.append(g)
    if not chunks:
        return pd.DataFrame()
    all_df = pd.concat(chunks, ignore_index=True)
    periods = sorted(all_df["period"].dropna().unique())
    rows = []
    for (skey, mkt), grp in all_df.groupby(["strategy_key", "market"]):
        sub = grp.set_index("period")["benchmark_return"]
        cum = 1.0
        row = {"strategy_key": skey, "market": mkt}
        eq_vals = []
        for p in periods:
            r = sub.get(p, np.nan)
            if pd.notna(r):
                cum *= (1.0 + float(r))
            row[f"equity_{p}"] = cum
            eq_vals.append(cum)
        arr = np.array(eq_vals)
        peak = np.maximum.accumulate(arr)
        dd = (arr / peak) - 1.0
        row["max_drawdown"] = float(np.min(dd)) if len(dd) else 0.0
        rows.append(row)
    return pd.DataFrame(rows)


def _synthesize_gpt_drawdowns(runs_df):
    """Build calc_gpt_drawdowns-like frame from run-level returns."""
    if runs_df is None or len(runs_df) == 0:
        return pd.DataFrame()
    id_col = "trajectory_id" if "trajectory_id" in runs_df.columns else ("run_id" if "run_id" in runs_df.columns else None)
    if not id_col or "period" not in runs_df.columns or "market" not in runs_df.columns:
        return pd.DataFrame()
    ret_col = "net_return" if "net_return" in runs_df.columns else ("period_return_net" if "period_return_net" in runs_df.columns else None)
    if not ret_col:
        return pd.DataFrame()
    periods = sorted(runs_df["period"].dropna().unique())
    rows = []
    for (traj, mkt), grp in runs_df.groupby([id_col, "market"]):
        g = grp.sort_values("period")
        prompt = g["prompt_type"].iloc[0] if "prompt_type" in g.columns else "unknown"
        pl = str(prompt).lower()
        sk = "gpt_retail" if pl == "retail" else "gpt_advanced" if pl == "advanced" else "gpt_unknown"
        rets = g.set_index("period")[ret_col]
        cum = 1.0
        row = {"trajectory_id": traj, "strategy_key": sk, "prompt_type": pl, "market": mkt}
        eq_vals = []
        for p in periods:
            r = rets.get(p, np.nan)
            if pd.notna(r):
                cum *= (1.0 + float(r))
            row[f"equity_{p}"] = cum
            eq_vals.append(cum)
        arr = np.array(eq_vals)
        peak = np.maximum.accumulate(arr)
        dd = (arr / peak) - 1.0
        row["max_drawdown"] = float(np.min(dd)) if len(dd) else 0.0
        rows.append(row)
    return pd.DataFrame(rows)


def _synthesize_strat_cells_from_benchmarks(xls):
    """Build calc_strategy_cells-like frame for By Market tab."""
    specs = [
        (("Index benchmark", "Index Benchmark", "index benchmark", "Market index benchmark"), "index"),
        (("60-40 benchmark", "60/40 benchmark", "60-40 Benchmark", "6040 benchmark"), "sixty_forty"),
        (("Equal weight benchmark", "Equal Weight benchmark"), "equal_weight"),
        (("Mean-variance benchmark", "Mean variance benchmark", "Mean-Variance benchmark"), "mean_variance"),
        (("Fama-French benchmark", "Fama French benchmark"), "fama_french"),
    ]
    rows = []
    for cands, skey in specs:
        sn = _match_excel_sheet(xls, *cands)
        if not sn:
            continue
        df = _ensure_benchmark_standard_columns(_normalize_benchmark_geo_columns(pd.read_excel(xls, sn)))
        if "benchmark_sharpe" not in df.columns and "benchmark_return" not in df.columns:
            continue
        g = df.groupby(["market", "period"], as_index=False).first()
        for _, r in g.iterrows():
            entry = {"strategy_key": skey, "market": r["market"], "period": r["period"]}
            if "benchmark_sharpe" in df.columns:
                entry["sharpe"] = r["benchmark_sharpe"]
            if "benchmark_return" in df.columns:
                entry["period_return"] = r["benchmark_return"]
            rows.append(entry)
    return pd.DataFrame(rows)


def _synthesize_strategy_summary_from_cells(cells_df: pd.DataFrame) -> pd.DataFrame:
    """Build Overview-style benchmark rows when calc_strategy_summary / Overview table is absent."""
    if cells_df is None or len(cells_df) == 0 or "strategy_key" not in cells_df.columns:
        return pd.DataFrame()
    label_map = {
        "index": "Market index",
        "sixty_forty": "60/40",
        "equal_weight": "Equal weight",
        "mean_variance": "Mean-variance",
        "fama_french": "Fama-French",
    }
    rows = []
    for sk, g in cells_df.groupby("strategy_key"):
        sks = str(sk)
        if sks not in label_map:
            continue
        row = {
            "Strategy": label_map[sks],
            "strategy_key": sks,
            "mean_sharpe": float(pd.to_numeric(g["sharpe"], errors="coerce").mean()) if "sharpe" in g.columns else np.nan,
            "net_return_mean": float(pd.to_numeric(g["period_return"], errors="coerce").mean()) if "period_return" in g.columns else np.nan,
            "n_observations": int(len(g)),
            "pct_runs_beating_index_sharpe": np.nan,
            "pct_runs_beating_sixty_forty_sharpe": np.nan,
        }
        rows.append(row)
    return pd.DataFrame(rows)


def _synthesize_gpt_cells_from_runs(runs_df, xls):
    """Build calc_gpt_cells-like aggregates for charts."""
    if runs_df is None or len(runs_df) == 0 or "prompt_type" not in runs_df.columns:
        return pd.DataFrame()
    id_col = "trajectory_id" if "trajectory_id" in runs_df.columns else "run_id"
    if id_col not in runs_df.columns:
        return pd.DataFrame()
    ret_col = "net_return" if "net_return" in runs_df.columns else ("period_return_net" if "period_return_net" in runs_df.columns else None)

    idx_sharpe = None
    s60_sharpe = None
    if xls is not None:
        _idx_sn = _match_excel_sheet(xls, "Index benchmark", "Index Benchmark", "index benchmark", "Market index benchmark")
        if _idx_sn:
            idx_df = _ensure_benchmark_standard_columns(_normalize_benchmark_geo_columns(pd.read_excel(xls, _idx_sn)))
            if "benchmark_sharpe" in idx_df.columns:
                idx_sharpe = idx_df.groupby(["market", "period"], as_index=False).first()[["market", "period", "benchmark_sharpe"]]
                idx_sharpe = idx_sharpe.rename(columns={"benchmark_sharpe": "_idx_sr"})
        _60_sn = _match_excel_sheet(xls, "60-40 benchmark", "60/40 benchmark", "60-40 Benchmark", "6040 benchmark")
        if _60_sn:
            s60_df = _ensure_benchmark_standard_columns(_normalize_benchmark_geo_columns(pd.read_excel(xls, _60_sn)))
            if "benchmark_sharpe" in s60_df.columns:
                s60_sharpe = s60_df.groupby(["market", "period"], as_index=False).first()[["market", "period", "benchmark_sharpe"]]
                s60_sharpe = s60_sharpe.rename(columns={"benchmark_sharpe": "_60_sr"})

    merged = runs_df.copy()
    if idx_sharpe is not None:
        merged = merged.merge(idx_sharpe, on=["market", "period"], how="left")
    if s60_sharpe is not None:
        merged = merged.merge(s60_sharpe, on=["market", "period"], how="left")

    def agg_group(g):
        out = {
            "valid_run_count": g[id_col].nunique(),
            "cell_mean_sharpe": g["sharpe_ratio"].mean() if "sharpe_ratio" in g.columns else np.nan,
        }
        if ret_col:
            out["cell_mean_return"] = g[ret_col].mean()
        if "_idx_sr" in g.columns and "sharpe_ratio" in g.columns:
            beats = (g["sharpe_ratio"] > g["_idx_sr"]).sum()
            out["beat_index_pct"] = 100.0 * beats / len(g) if len(g) else np.nan
        if "_60_sr" in g.columns and "sharpe_ratio" in g.columns:
            beats = (g["sharpe_ratio"] > g["_60_sr"]).sum()
            out["beat_sixty_forty_pct"] = 100.0 * beats / len(g) if len(g) else np.nan
        return pd.Series(out)

    gpt = merged[merged["prompt_type"].astype(str).str.lower().isin(["retail", "advanced"])]
    if len(gpt) == 0:
        return pd.DataFrame()
    records = []
    for (m, p, pt), g in gpt.groupby(["market", "period", "prompt_type"]):
        ser = agg_group(g)
        records.append({"market": m, "period": p, "prompt_type": pt, **ser.to_dict()})
    return pd.DataFrame(records)


def _synthesize_periods_data_from_benchmarks(xls):
    """Pool benchmark period returns across markets for Sharpe tab."""
    specs = [
        (("Index benchmark", "Index Benchmark", "index benchmark", "Market index benchmark"), "index"),
        (("60-40 benchmark", "60/40 benchmark", "60-40 Benchmark", "6040 benchmark"), "sixty_forty"),
        (("Equal weight benchmark", "Equal Weight benchmark"), "equal_weight"),
        (("Mean-variance benchmark", "Mean variance benchmark", "Mean-Variance benchmark"), "mean_variance"),
    ]
    rows = []
    for cands, skey in specs:
        sn = _match_excel_sheet(xls, *cands)
        if not sn:
            continue
        df = _ensure_benchmark_standard_columns(_normalize_benchmark_geo_columns(pd.read_excel(xls, sn)))
        if "benchmark_return" not in df.columns:
            continue
        g = df.groupby(["market", "period"], as_index=False).first()
        for _, r in g.iterrows():
            rows.append({"strategy_key": skey, "market": r["market"], "period": r["period"], "period_return": r["benchmark_return"]})
    return pd.DataFrame(rows)


def _holdings_sheet_as_runs_long(holdings_df, runs_df):
    """Use the separate 'Portfolio holdings' sheet as runs_long when Portfolio runs is not long-format.

    The holdings sheet typically has per-stock rows with columns like
    trajectory_id/run_id, market, period, holding_ticker, holding_weight, etc.
    We also try common alternative column names (ticker, weight, name, sector).
    """
    if holdings_df is None or len(holdings_df) == 0:
        return pd.DataFrame()

    col_map = {}
    for target, candidates in [
        ("holding_ticker", ["holding_ticker", "ticker", "symbol", "asset", "instrument"]),
        ("holding_weight", ["holding_weight", "weight", "allocation", "pct_weight"]),
        ("holding_name", ["holding_name", "name", "company", "security_name"]),
        ("holding_sector", ["holding_sector", "sector", "gics_sector"]),
        ("holding_rank", ["holding_rank", "rank"]),
        ("holding_asset_class", ["holding_asset_class", "asset_class"]),
        ("holding_entry_price", ["holding_entry_price", "entry_price", "price_bought", "buy_price",
                                  "price_at_entry", "purchase_price", "cost_basis", "open_price"]),
        ("holding_current_price", ["holding_current_price", "current_price", "price_now", "close_price",
                                    "last_price", "market_price", "end_price", "price_at_end"]),
    ]:
        for cand in candidates:
            if cand in holdings_df.columns and target not in col_map.values():
                col_map[cand] = target
                break

    if "holding_ticker" not in col_map.values():
        return pd.DataFrame()

    hdf = holdings_df.rename(columns=col_map).copy()

    id_col = next((c for c in ["trajectory_id", "run_id", "portfolio_id"] if c in hdf.columns), None)
    has_period = "period" in hdf.columns
    has_market = "market" in hdf.columns

    if not id_col or not has_period or not has_market:
        return pd.DataFrame()

    if "holding_weight" not in col_map.values():
        return pd.DataFrame()

    if runs_df is not None and len(runs_df) > 0:
        run_cols_to_add = [c for c in [
            "prompt_type", "model", "portfolio_key", "source_file",
            "experiment_id", "sharpe_ratio", "net_return", "period_return_net",
            "period_return", "hhi", "effective_n_holdings", "n_holdings",
        ] if c in runs_df.columns and c not in hdf.columns]

        if run_cols_to_add:
            join_keys = [c for c in [id_col, "market", "period"] if c in runs_df.columns and c in hdf.columns]
            if join_keys:
                hdf = hdf.merge(
                    runs_df[join_keys + run_cols_to_add].drop_duplicates(subset=join_keys),
                    on=join_keys, how="left",
                )

    reasoning_src = [c for c in holdings_df.columns if any(
        kw in c.lower() for kw in ["reason", "rationale", "narrative", "explanation", "summary", "justification"]
    ) and c not in hdf.columns]
    for rc in reasoning_src:
        hdf[rc] = holdings_df[rc]

    return hdf


def _audit_and_news_for_portfolio_slice(audit_df, news_df, runs_long_df, market, period, trajectory_id=None):
    """Restrict audit + news rows to tickers held in runs_long for one market × period (optional trajectory)."""
    empty_a, empty_n = pd.DataFrame(), pd.DataFrame()
    if runs_long_df is None or len(runs_long_df) == 0 or "holding_ticker" not in runs_long_df.columns:
        return empty_a, empty_n, []
    rl = runs_long_df.copy()
    rl["period"] = rl["period"].map(lambda x: str(x).strip() if pd.notna(x) else x)
    m = _canonical_market_value(market)
    p = str(period).strip()
    rl = rl[(rl["market"].map(_canonical_market_value) == m) & (rl["period"].astype(str).str.strip() == p)]
    if trajectory_id and str(trajectory_id).strip() not in ("", "(all)", "All") and "trajectory_id" in rl.columns:
        rl = rl[rl["trajectory_id"].astype(str) == str(trajectory_id)]
    tickers = sorted({str(t).strip() for t in rl["holding_ticker"].dropna().tolist() if str(t).strip()})
    if not tickers:
        return empty_a, empty_n, []

    def _slice(df):
        if df is None or len(df) == 0 or "ticker" not in df.columns:
            return pd.DataFrame()
        d = df.copy()
        d["period"] = d["period"].map(lambda x: str(x).strip() if pd.notna(x) else x)
        d = d[(d["market"].map(_canonical_market_value) == m) & (d["period"].astype(str).str.strip() == p)]
        return d[d["ticker"].astype(str).str.strip().isin(tickers)].copy()

    return _slice(audit_df), _slice(news_df), tickers


def _load_regime_labels():
    """Load regime labels from local file or the Regime data folder.

    If several files exist, uses the one with the newest modification time.
    """
    candidates = [
        Path(__file__).resolve().parent / "regime_labels_verified.xlsx",
        Path(__file__).resolve().parent / "regime_output.xlsx",
        Path.home() / "Regime data" / "regime_output.xlsx",
        Path.home() / "Regime data" / "regime_labels_verified.xlsx",
    ]
    existing = [p for p in candidates if p.exists()]
    regime_path = max(existing, key=lambda p: p.stat().st_mtime) if existing else None
    if regime_path is None:
        return pd.DataFrame()
    try:
        df = pd.read_excel(regime_path, "Regime Labels")
    except Exception:
        return pd.DataFrame()
    if df.empty or "Period" not in df.columns or "Market" not in df.columns:
        return pd.DataFrame()

    # "H2 2021" → "2021H2",  "H1 2022" → "2022H1"
    def _norm_period(p):
        parts = str(p).strip().split()
        if len(parts) == 2:
            return f"{parts[1]}{parts[0]}"
        return str(p).strip()

    mkt_map = {"US": "us", "DE": "germany", "JP": "japan"}
    df["period"] = df["Period"].apply(_norm_period)
    df["market"] = df["Market"].map(mkt_map).fillna(df["Market"].str.lower())
    return df


def _merge_regime_into_runs(data):
    """Left-join regime labels onto runs and runs_long by (market, period)."""
    regime = _load_regime_labels()
    if regime.empty:
        return
    data["regime"] = regime
    regime_cols = ["period", "market", "Market_Label", "Vol_Label", "Rate_Label",
                   "Return_%", "Avg_Vol", "Yield_Chg_bp"]
    regime_slim = regime[[c for c in regime_cols if c in regime.columns]].drop_duplicates(
        subset=["period", "market"]
    )
    for key in ("runs", "runs_long"):
        df = data.get(key)
        if df is None or len(df) == 0 or "period" not in df.columns or "market" not in df.columns:
            continue
        has_trend = (
            "Market_Label" in df.columns
            and df["Market_Label"].notna().any()
            and df["Market_Label"].astype(str).str.strip().ne("").any()
        )
        if has_trend:
            aux = [c for c in ("Return_%", "Avg_Vol", "Yield_Chg_bp") if c in regime_slim.columns]
            need = [c for c in aux if c not in df.columns or not df[c].notna().any()]
            if not need:
                continue
            sub = regime_slim[["market", "period"] + need].drop_duplicates(subset=["market", "period"])
            data[key] = df.merge(sub, on=["market", "period"], how="left")
            continue
        df = df.copy()
        for rc in ["Market_Label", "Vol_Label", "Rate_Label", "Return_%", "Avg_Vol", "Yield_Chg_bp"]:
            if rc in df.columns:
                df = df.drop(columns=[rc])
        data[key] = df.merge(regime_slim, on=["market", "period"], how="left")


def _augment_evaluation_package(data, xls):
    """Fill missing legacy sheets from Overview + benchmark tabs (new export layout)."""
    if len(data.get("runs", pd.DataFrame())) > 0:
        collapsed, long_df = _normalize_portfolio_runs(data["runs"])
        data["runs"] = collapsed
        if len(long_df) > 0:
            data["runs_long"] = long_df

    if len(data.get("runs_long", pd.DataFrame())) == 0:
        hlong = _holdings_sheet_as_runs_long(
            data.get("holdings", pd.DataFrame()),
            data.get("runs", pd.DataFrame()),
        )
        if len(hlong) > 0:
            data["runs_long"] = hlong

    if len(data.get("summary", pd.DataFrame())) == 0:
        snap = _parse_overview_strategy_snapshot(xls)
        if len(snap) > 0:
            data["summary"] = snap

    if len(data.get("behavior", pd.DataFrame())) == 0:
        beh = _parse_overview_portfolio_behavior(xls)
        if len(beh) > 0:
            data["behavior"] = beh

    if len(data.get("strategy_paths", pd.DataFrame())) == 0:
        sp = _synthesize_strategy_paths_from_benchmarks(xls)
        if len(sp) > 0:
            data["strategy_paths"] = sp

    if len(data.get("gpt_drawdowns", pd.DataFrame())) == 0 and len(data.get("runs", pd.DataFrame())) > 0:
        dd = _synthesize_gpt_drawdowns(data["runs"])
        if len(dd) > 0:
            data["gpt_drawdowns"] = dd

    if len(data.get("gpt_cells", pd.DataFrame())) == 0 and len(data.get("runs", pd.DataFrame())) > 0:
        cells = _synthesize_gpt_cells_from_runs(data["runs"], xls)
        if len(cells) > 0:
            data["gpt_cells"] = cells

    if len(data.get("strategy_cells", pd.DataFrame())) == 0:
        sc = _synthesize_strat_cells_from_benchmarks(xls)
        if len(sc) > 0:
            data["strategy_cells"] = sc

    if len(data.get("summary", pd.DataFrame())) == 0 and len(data.get("strategy_cells", pd.DataFrame())) > 0:
        summ_b = _synthesize_strategy_summary_from_cells(data["strategy_cells"])
        if len(summ_b) > 0:
            data["summary"] = summ_b

    if len(data.get("periods_data", pd.DataFrame())) == 0:
        pd_ = _synthesize_periods_data_from_benchmarks(xls)
        if len(pd_) > 0:
            data["periods_data"] = pd_

    _merge_regime_into_runs(data)


def _portfolio_run_period_strs(data):
    """Periods that actually appear in Portfolio runs (source of truth for this upload)."""
    r = data.get("runs", pd.DataFrame())
    if r is None or len(r) == 0 or "period" not in r.columns:
        return None
    return {str(x).strip() for x in r["period"].dropna().unique()}


def _summary_beat_rates_with_gpt_pooled_mean(summary_df: pd.DataFrame, pct_col: str) -> pd.DataFrame:
    """Beat-rate rows with non-null pct, plus **GPT (mean of 2 prompts)** = mean of Retail & Advanced beat %."""
    if summary_df is None or len(summary_df) == 0 or pct_col not in summary_df.columns:
        return pd.DataFrame()
    base = summary_df[summary_df[pct_col].notna()].copy()
    if len(base) == 0:
        return base
    if "strategy_key" not in base.columns:
        return base
    gpt = base[base["strategy_key"].isin(["gpt_retail", "gpt_advanced"])]
    vals = pd.to_numeric(gpt[pct_col], errors="coerce").dropna()
    if len(vals) == 0:
        return base.sort_values(pct_col, ascending=True)
    pooled = float(vals.mean())
    extra = pd.DataFrame(
        [{"Strategy": "GPT (mean of 2 prompts)", "strategy_key": "gpt_pooled_mean", pct_col: pooled}]
    )
    out = pd.concat([base, extra], ignore_index=True, sort=False)
    return out.sort_values(pct_col, ascending=True)


def _clip_package_to_portfolio_run_periods(data):
    """
    Legacy/template sheets (calc_strategy_paths, Data quality, calc_strategy_periods_data, etc.)
    may still list 2021+ even when Portfolio runs only contains 2025. Align everything to run periods
    so charts and KPIs do not show years that are not in this evaluation.
    """
    P = _portfolio_run_period_strs(data)
    if not P:
        return

    def _clip_rows(df_key):
        df = data.get(df_key)
        if df is None or len(df) == 0 or "period" not in df.columns:
            return
        s = df["period"].map(lambda x: str(x).strip() if pd.notna(x) else "")
        data[df_key] = df[s.isin(P)].copy()

    for key in ("periods_data", "data_quality", "gpt_cells", "strategy_cells", "benchmarks", "postloss", "data_audit", "news"):
        _clip_rows(key)

    rl = data.get("runs_long")
    if rl is not None and len(rl) > 0 and "period" in rl.columns:
        s = rl["period"].map(lambda x: str(x).strip() if pd.notna(x) else "")
        data["runs_long"] = rl[s.isin(P)].copy()

    for key in ("strategy_paths", "gpt_drawdowns"):
        df = data.get(key)
        if df is None or len(df) == 0:
            continue
        base = [c for c in df.columns if not str(c).startswith("equity_")]
        eq_keep = [
            c for c in df.columns
            if str(c).startswith("equity_") and str(c).replace("equity_", "").strip() in P
        ]
        if eq_keep:
            data[key] = df[base + eq_keep].copy()


def _finalize_gpt_metrics_from_portfolio_runs(data, xls):
    """
    GPT rows in strategy summary + portfolio behavior + gpt_cells must match Portfolio runs
    (aggregations of the same rows you uploaded), not the Overview snapshot or stale templates.
    Benchmark strategy rows in summary stay as loaded (calc_strategy_summary / Overview non-GPT only).
    """
    runs = data.get("runs", pd.DataFrame())
    if runs is None or len(runs) == 0 or "prompt_type" not in runs.columns:
        return
    gpt = runs[runs["prompt_type"].astype(str).str.lower().isin(["retail", "advanced"])].copy()
    if len(gpt) == 0:
        return

    ret_col = "net_return" if "net_return" in gpt.columns else (
        "period_return_net" if "period_return_net" in gpt.columns else None
    )

    # ── Behavior: only columns the Portfolio Behavior tab reads ──
    beh_rows = []

    def _m(sub, col):
        if col in sub.columns:
            return float(sub[col].mean())
        return np.nan

    for pt in ["retail", "advanced"]:
        sub = gpt[gpt["prompt_type"].astype(str).str.lower() == pt]
        if len(sub) == 0:
            continue
        mt = _m(sub, "turnover")
        beh_rows.append({
            "prompt_type": pt,
            "mean_hhi": _m(sub, "hhi"),
            "mean_effective_n_holdings": _m(sub, "effective_n_holdings"),
            "mean_turnover": mt,
            "median_turnover": float(sub["turnover"].median()) if "turnover" in sub.columns else np.nan,
            "mean_expected_portfolio_return_6m": _m(sub, "expected_portfolio_return_6m"),
            "mean_realized_net_return": float(sub[ret_col].mean()) if ret_col else np.nan,
            "mean_forecast_bias": _m(sub, "forecast_bias"),
            "mean_forecast_abs_error": _m(sub, "forecast_abs_error"),
        })
    if beh_rows:
        data["behavior"] = pd.DataFrame(beh_rows)

    # ── Benchmark Sharpe by (market, period) from same-file strategy_cells (already period-clipped) ──
    strat_cells = data.get("strategy_cells", pd.DataFrame())
    idx_map, s60_map = {}, {}
    if len(strat_cells) > 0 and all(c in strat_cells.columns for c in ("strategy_key", "market", "period", "sharpe")):
        for _, r in strat_cells[strat_cells["strategy_key"] == "index"].iterrows():
            idx_map[(str(r["market"]).strip(), str(r["period"]).strip())] = r["sharpe"]
        for _, r in strat_cells[strat_cells["strategy_key"] == "sixty_forty"].iterrows():
            s60_map[(str(r["market"]).strip(), str(r["period"]).strip())] = r["sharpe"]

    summ = data.get("summary", pd.DataFrame())
    if len(summ) > 0 and "Strategy" in summ.columns:
        non_gpt = summ[~summ["Strategy"].astype(str).str.contains("GPT", case=False, na=False)].copy()
    else:
        non_gpt = pd.DataFrame()

    gpt_summ_rows = []
    for pt, label, sk in [
        ("retail", "GPT (Retail prompt)", "gpt_retail"),
        ("advanced", "GPT (Advanced Prompting)", "gpt_advanced"),
    ]:
        sub = gpt[gpt["prompt_type"].astype(str).str.lower() == pt]
        if len(sub) == 0:
            continue
        ms = float(sub["sharpe_ratio"].mean()) if "sharpe_ratio" in sub.columns else np.nan
        mr = float(sub[ret_col].mean()) if ret_col else np.nan
        n_obs = int(len(sub))

        pct_idx, pct_60 = np.nan, np.nan
        if "sharpe_ratio" in sub.columns:
            bi, b6 = 0, 0
            n_ok_i, n_ok_6 = 0, 0
            for _, row in sub.iterrows():
                k = (str(row["market"]).strip(), str(row["period"]).strip())
                sr = row["sharpe_ratio"]
                if k in idx_map and pd.notna(sr) and pd.notna(idx_map[k]):
                    n_ok_i += 1
                    if sr > idx_map[k]:
                        bi += 1
                if k in s60_map and pd.notna(sr) and pd.notna(s60_map[k]):
                    n_ok_6 += 1
                    if sr > s60_map[k]:
                        b6 += 1
            if n_ok_i:
                pct_idx = 100.0 * bi / n_ok_i
            if n_ok_6:
                pct_60 = 100.0 * b6 / n_ok_6

        gpt_summ_rows.append({
            "Strategy": label,
            "mean_sharpe": ms,
            "net_return_mean": mr,
            "n_observations": n_obs,
            "pct_runs_beating_index_sharpe": pct_idx,
            "pct_runs_beating_sixty_forty_sharpe": pct_60,
            "strategy_key": sk,
        })

    if not gpt_summ_rows:
        return

    gpt_df = pd.DataFrame(gpt_summ_rows)
    if len(non_gpt) > 0:
        data["summary"] = pd.concat([non_gpt, gpt_df], ignore_index=True, sort=False)
    else:
        data["summary"] = gpt_df

    # ── GPT cell aggregates: always recompute from runs + benchmarks in this file ──
    try:
        cells = _synthesize_gpt_cells_from_runs(runs, xls)
        if len(cells) > 0:
            data["gpt_cells"] = cells
    except Exception:
        pass


def _normalize_data_audit_trailing_returns(ad: pd.DataFrame) -> pd.DataFrame:
    """Repair ``trailing_return_6m`` when the whole sheet is ~100× too small vs ``trailing_vol_6m``.

    Some Excel exports write 6m return with an extra /100 (values like 0.005 while vol is 0.29 for 29%).
    Pipeline CSVs use the same fraction convention for both (~0.50 return, ~0.29 vol). When the median
    absolute return is tiny but median vol is equity-like, scale returns ×100 once for the whole column.
    """
    if ad is None or len(ad) == 0 or "trailing_return_6m" not in ad.columns:
        return ad
    if "trailing_vol_6m" not in ad.columns:
        return ad
    out = ad.copy()
    r = pd.to_numeric(out["trailing_return_6m"], errors="coerce")
    v = pd.to_numeric(out["trailing_vol_6m"], errors="coerce")
    med_abs_r = float(r.abs().median())
    med_v = float(v.median()) if v.notna().any() else np.nan
    if (
        pd.notna(med_v)
        and med_v > 0.12
        and pd.notna(med_abs_r)
        and med_abs_r < 0.008
        and med_abs_r < med_v / 10.0
    ):
        out["trailing_return_6m"] = r * 100.0
    return out


def load_data(file):
    """Load all relevant sheets from the evaluation package."""
    xls = pd.ExcelFile(file)
    data = {}

    sheet_specs = {
        "summary": ("calc_strategy_summary", "Strategy summary", "strategy_summary"),
        "runs": ("Portfolio runs", "Portfolio Runs", "Runs", "GPT runs", "PortfolioRuns"),
        "behavior": ("Portfolio behavior", "Portfolio Behavior", "portfolio_behavior"),
        "benchmarks": ("Benchmarks", "Benchmark summary", "benchmarks"),
        "stats": ("Stats tests", "Statistical tests", "Stats Tests", "stats_tests", "Statistical Tests"),
        "postloss": ("Post-loss rebalance", "Post loss rebalance", "Post-Loss Rebalance", "post_loss_rebalance"),
        "gpt_cells": ("calc_gpt_cells", "GPT cells", "gpt_cells"),
        "gpt_drawdowns": ("calc_gpt_drawdowns", "GPT drawdowns", "gpt_drawdowns"),
        "strategy_paths": ("calc_strategy_paths", "Strategy paths", "strategy_paths"),
        "strategy_cells": ("calc_strategy_cells", "Strategy cells", "strategy_cells"),
        "strategy_defs": ("calc_strategy_defs", "Strategy definitions", "strategy_defs"),
        "periods_data": ("calc_strategy_periods_data", "Strategy periods data", "periods_data"),
        "scope": ("calc_scope", "Scope", "scope"),
        "data_quality": ("Data quality", "Data Quality", "data_quality", "DataQuality"),
        "data_audit": ("Data audit", "Data Audit", "data_audit", "Stock audit"),
        "news": ("News", "Stock news", "news_items"),
        "holdings": ("Portfolio holdings", "Portfolio Holdings", "Holdings", "portfolio_holdings"),
    }

    for key, candidates in sheet_specs.items():
        sn = _match_excel_sheet(xls, *candidates)
        if sn:
            data[key] = pd.read_excel(xls, sn)
        else:
            data[key] = pd.DataFrame()

    if len(data.get("runs", pd.DataFrame())) > 0:
        data["runs"] = _normalize_portfolio_runs_sheet(data["runs"])

    if len(data.get("data_audit", pd.DataFrame())) > 0:
        data["data_audit"] = _normalize_benchmark_geo_columns(data["data_audit"])
        data["data_audit"] = _normalize_data_audit_trailing_returns(data["data_audit"])
    if len(data.get("news", pd.DataFrame())) > 0:
        data["news"] = _normalize_benchmark_geo_columns(data["news"])

    data["postloss"] = _normalize_postloss_sheet(data.get("postloss", pd.DataFrame()))

    _augment_evaluation_package(data, xls)
    _clip_package_to_portfolio_run_periods(data)
    _finalize_gpt_metrics_from_portfolio_runs(data, xls)
    return data


@st.cache_data(show_spinner="Loading evaluation package…")
def load_data_cached(content_sha256: str, raw_bytes: bytes):
    """Same output as ``load_data(io.BytesIO(...))``; cached by file hash across reruns and sessions."""
    return load_data(io.BytesIO(raw_bytes))


def _equity_columns_from_paths(paths_df):
    if paths_df is None or len(paths_df) == 0:
        return []
    cols = [c for c in paths_df.columns if str(c).startswith("equity_")]
    return sorted(cols, key=lambda x: x.replace("equity_", ""))


@st.cache_data
def build_equity_curves(paths_df):
    """Build equity curve data from calc_strategy_paths."""
    existing_cols = _equity_columns_from_paths(paths_df)

    if not existing_cols:
        return pd.DataFrame()

    rows = []
    for _, row in paths_df.iterrows():
        strategy = row.get("strategy_key", "unknown")
        market = row.get("market", "unknown")
        rows.append({"strategy": strategy, "market": market, "period": "Start", "equity": 1.0})
        for col in existing_cols:
            period = col.replace("equity_", "")
            val = row.get(col, np.nan)
            if pd.notna(val):
                rows.append({"strategy": strategy, "market": market, "period": period, "equity": val})

    return pd.DataFrame(rows)


@st.cache_data
def build_gpt_equity_curves(dd_df):
    """Build GPT trajectory equity curves from calc_gpt_drawdowns."""
    existing_cols = _equity_columns_from_paths(dd_df)

    if not existing_cols:
        return pd.DataFrame()

    rows = []
    for _, row in dd_df.iterrows():
        traj = row.get("trajectory_id", "unknown")
        strategy = row.get("strategy_key", "unknown")
        prompt = row.get("prompt_type", "unknown")
        market = row.get("market", "unknown")
        rows.append({"trajectory": traj, "strategy": strategy, "prompt": prompt, "market": market, "period": "Start", "equity": 1.0})
        for col in existing_cols:
            period = col.replace("equity_", "")
            val = row.get(col, np.nan)
            if pd.notna(val):
                rows.append({"trajectory": traj, "strategy": strategy, "prompt": prompt, "market": market, "period": period, "equity": val})

    return pd.DataFrame(rows)


# ══════════════════════════════════════════════════════════════
# MAIN APP
# ══════════════════════════════════════════════════════════════

st.markdown(
    '<h2 style="margin-bottom:2px; letter-spacing:-0.5px;">LLM Portfolio Evaluation Dashboard</h2>',
    unsafe_allow_html=True,
)
st.caption(
    "Empirical study of AI-based portfolio construction and rebalancing for retail investors — "
    "GPT prompts are interpreted **relative to market benchmarks** (index, 60/40, equal weight, etc.) wherever data allows."
)

# ── Sidebar ──
with st.sidebar:
    st.markdown(
        '<p style="font-size:11px;color:#5E7082;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:12px;">Data Source</p>',
        unsafe_allow_html=True,
    )
    uploaded = st.file_uploader("Upload evaluation package (.xlsx)", type=["xlsx"])
    _def_pkg = _default_evaluation_package_path()
    if _def_pkg is not None:
        st.caption(f"Auto-loads **`{_def_pkg.name}`** from the app folder when the uploader is empty.")

    market_filter = "All"
    if "data" in st.session_state:
        markets = ["All"] + sorted(st.session_state["data"]["runs"]["market"].dropna().unique().tolist())
        market_filter = st.selectbox("Market filter", markets, help="Filter all tabs to a single market")

    st.markdown("---")
    st.markdown(
        '<p style="font-size:11px;color:#5E7082;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:12px;">AI Assistant</p>',
        unsafe_allow_html=True,
    )
    _po = _persisted_openai_key()
    openai_field = st.text_input(
        "OpenAI API key",
        type="password",
        key="openai_key",
        placeholder="sk-..." if not _po else "Leave empty — using saved key",
        help="Paste once and it is saved next to app.py as .openai_api_key (or set OPENAI_API_KEY / secrets.toml).",
    )
    _typed = (openai_field or "").strip()
    if len(_typed) >= 20:
        try:
            if _typed != _read_local_openai_key():
                _write_local_openai_key(_typed)
                st.session_state.pop("openai_key", None)
                st.rerun()
        except OSError:
            st.caption("Could not save API key to disk (check folder permissions).")
    openai_key = _typed or _po
    _src = _openai_key_source_label()
    if openai_key:
        if _src:
            st.markdown(
                f'<span style="color:#34D399;font-size:11px;">&#x2713; Using key from {_src}</span>',
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                '<span style="color:#34D399;font-size:11px;">&#x2713; API key in use (sidebar)</span>',
                unsafe_allow_html=True,
            )
    if _read_local_openai_key():
        if st.button("Forget locally saved API key", key="forget_local_openai_key", type="secondary"):
            try:
                _local_openai_key_path().unlink(missing_ok=True)
            except OSError:
                pass
            st.session_state.pop("openai_key", None)
            st.rerun()
    ai_model = st.selectbox(
        "Model",
        ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
         "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano",
         "o4-mini", "o3", "o3-mini"],
        index=6,
        key="ai_model",
        help="gpt-5.4 is the strongest; mini/nano are faster and cheaper",
    )

    st.markdown("---")
    with st.expander("Thesis scope", expanded=False):
        st.markdown("""
**Markets:** S&P 500, DAX 40, Nikkei 225  
**Prompts:** Retail, Advanced  
**Periods:** From uploaded package  
**Benchmarks:** Mean-variance, 1/N, 60/40, Market index, Fama-French
""")


# ── Load data ──
# Fingerprint file *contents* (name + size alone misses different workbooks with same name/size).
raw_bytes = None
package_label = None
if uploaded is not None:
    raw_bytes = uploaded.getvalue()
    package_label = uploaded.name
else:
    _def_path = _default_evaluation_package_path()
    if _def_path is not None:
        try:
            _rp = str(_def_path.resolve())
            _mt = _def_path.stat().st_mtime_ns
            if (
                st.session_state.get("_pkg_read_path") == _rp
                and st.session_state.get("_pkg_read_mtime") == _mt
                and st.session_state.get("_pkg_read_bytes") is not None
            ):
                raw_bytes = st.session_state["_pkg_read_bytes"]
            else:
                raw_bytes = _def_path.read_bytes()
                st.session_state["_pkg_read_path"] = _rp
                st.session_state["_pkg_read_mtime"] = _mt
                st.session_state["_pkg_read_bytes"] = raw_bytes
            package_label = _def_path.name
        except OSError:
            raw_bytes = None
            package_label = None

if raw_bytes is not None and package_label is not None:
    file_id = f"{package_label}__{hashlib.sha256(raw_bytes).hexdigest()}"
    if st.session_state.get("_loaded_file_id") != file_id:
        build_equity_curves.clear()
        build_gpt_equity_curves.clear()
        for _k in ("_memo_dqc_key", "_memo_dqc_issues", "_memo_dqc_passes", "_memo_dqc_profile"):
            st.session_state.pop(_k, None)
        _sha = hashlib.sha256(raw_bytes).hexdigest()
        st.session_state["data"] = load_data_cached(_sha, raw_bytes)
        st.session_state["_loaded_file_id"] = file_id
        st.session_state["_package_source"] = (
            f"Upload: {package_label}" if uploaded is not None else f"Local file: {package_label}"
        )
        st.session_state["dq_chat_history"] = []
        st.rerun()

if "data" not in st.session_state:
    st.markdown("")
    _c1, _c2, _c3 = st.columns([1, 2, 1])
    with _c2:
        _hint = (
            f'<p style="font-size:13px; color:#5E7082;">To skip uploading each time, place '
            f'<code>{DEFAULT_EVAL_PACKAGE_FILENAMES[0]}</code> (or the same name without <code>(1)</code>) '
            f'next to <code>app.py</code>.</p>'
        )
        st.markdown(
            '<div style="text-align:center; padding:60px 20px;">'
            '<p style="font-size:48px; margin-bottom:16px;">&#x1F4CA;</p>'
            '<p style="font-size:18px; color:#E2E8F0; font-weight:600; margin-bottom:8px;">No evaluation package loaded</p>'
            '<p style="font-size:13px; color:#5E7082;">Put the default workbook in the app folder, or upload an <code>.xlsx</code> in the sidebar.</p>'
            f"{_hint}"
            '</div>',
            unsafe_allow_html=True,
        )
    st.stop()

D = st.session_state["data"]

with st.sidebar:
    st.markdown("---")
    _runs_full = D.get("runs", pd.DataFrame())
    _n_runs = len(_runs_full)
    _n_mkts = _runs_full["market"].nunique() if len(_runs_full) > 0 and "market" in _runs_full.columns else 0
    _pers = sorted(_runs_full["period"].dropna().astype(str).unique()) if len(_runs_full) > 0 and "period" in _runs_full.columns else []
    _rl = D.get("runs_long", pd.DataFrame())
    _n_tickers = _rl["holding_ticker"].nunique() if len(_rl) > 0 and "holding_ticker" in _rl.columns else 0

    _badge_parts = [
        f'<strong>{_n_runs}</strong> runs',
        f'<strong>{_n_mkts}</strong> markets',
        f'<strong>{len(_pers)}</strong> periods',
    ]
    if _pers:
        _badge_parts.append(f'<span class="accent">{_pers[0]}</span> → <span class="accent">{_pers[-1]}</span>')
    if _n_tickers:
        _badge_parts.append(f'<span class="green">{_n_tickers}</span> unique tickers')

    st.markdown(f'<div class="file-badge">{" &middot; ".join(_badge_parts)}</div>', unsafe_allow_html=True)
    _pl = D.get("postloss", pd.DataFrame())
    _pl_req = {"prompt_type", "avg_turnover_after_loss", "avg_turnover_after_non_loss", "pct_rebalances_after_loss"}
    _pl_ready = len(_pl) > 0 and _pl_req <= set(_pl.columns)
    if _pl_ready:
        st.markdown(
            f'<div class="file-badge" style="margin-top:8px;border-color:#1E3D32;">'
            f'<span class="green">&#x2713; Post-loss sheet</span> &middot; <strong>{len(_pl)}</strong> rows'
            f"</div>",
            unsafe_allow_html=True,
        )
    elif len(_pl) > 0:
        st.markdown(
            '<div class="file-badge" style="margin-top:8px;">'
            '<span style="color:#FBBF24;">&#x26A0; Post-loss sheet</span> &mdash; missing expected columns'
            "</div>",
            unsafe_allow_html=True,
        )
    else:
        st.markdown(
            '<div class="file-badge" style="margin-top:8px;opacity:0.9;">'
            '<span class="accent">Post-loss sheet</span> not in package'
            "</div>",
            unsafe_allow_html=True,
        )
    _ps = st.session_state.get("_package_source")
    if _ps:
        st.caption(_ps)

    if st.button("Clear loaded file", key="forget_loaded_file", type="secondary",
                  help="Reset session and upload a different workbook"):
        build_equity_curves.clear()
        build_gpt_equity_curves.clear()
        for _k in (
            "data", "_loaded_file_id", "_package_source", "dq_chat_history",
            "_pkg_read_path", "_pkg_read_mtime", "_pkg_read_bytes",
            "_memo_dqc_key", "_memo_dqc_issues", "_memo_dqc_passes", "_memo_dqc_profile",
        ):
            st.session_state.pop(_k, None)
        load_data_cached.clear()
        st.rerun()

# Apply market filter to runs
runs = D["runs"].copy()
if market_filter != "All":
    runs = runs[runs["market"] == market_filter]

summary = D["summary"]
stats = D["stats"]
behavior = D["behavior"]
postloss = D["postloss"]
gpt_cells = D["gpt_cells"]
gpt_dd = D["gpt_drawdowns"]
strat_paths = D["strategy_paths"]
strat_cells = D["strategy_cells"]
periods_data = D["periods_data"]
benchmarks = D["benchmarks"]
dq = D["data_quality"]

strat_defs = D["strategy_defs"]
holdings_df = D["holdings"]
runs_long = D.get("runs_long", pd.DataFrame())
if market_filter != "All" and len(runs_long) > 0 and "market" in runs_long.columns:
    runs_long = runs_long[runs_long["market"] == market_filter].copy()

n_runs = len(runs[runs["valid"] == True]) if "valid" in runs.columns else len(runs)
n_markets = runs["market"].nunique() if "market" in runs.columns else 0
n_periods = runs["period"].nunique() if "period" in runs.columns else 0


# ══════════════════════════════════════════════════════════════
# TABS
# ══════════════════════════════════════════════════════════════

tab_overview, tab_performance, tab_portfolios, tab_runs, tab_regime, tab_research, tab_quality = \
    st.tabs([
        "Overview",
        "Performance",
        "Portfolios",
        "Run Explorer",
        "By Regime",
        "Tests & risk",
        "Data Quality",
    ])


# ══════════════════════════════════════════
# OVERVIEW
# ══════════════════════════════════════════
with tab_overview:
    # Hero metrics bar
    _hero_cols = st.columns(4)
    with _hero_cols[0]:
        kpi_card("Total Runs", str(n_runs), ACCENT, f"{n_markets} markets")
    with _hero_cols[1]:
        kpi_card("Periods", str(n_periods), CYAN, f"Filter: {market_filter}")
    with _hero_cols[2]:
        _best_sr = summary["mean_sharpe"].max() if len(summary) > 0 and "mean_sharpe" in summary.columns else np.nan
        _best_name = summary.loc[summary["mean_sharpe"].idxmax(), "Strategy"] if pd.notna(_best_sr) else "—"
        _best_short = _best_name.replace("GPT (", "").replace(")", "").replace(" (market-matched)", "").replace(" (buy-and-hold)", "")
        kpi_card("Best Sharpe", fmt(_best_sr, 2), sharpe_color(_best_sr), _best_short)
    with _hero_cols[3]:
        _gpt_runs = runs[runs["prompt_type"].isin(["retail", "advanced"])] if "prompt_type" in runs.columns else runs
        _gpt_beat = 0
        if len(_gpt_runs) > 0 and "sharpe_ratio" in _gpt_runs.columns:
            _idx_sharpe = summary[summary["strategy_key"] == "index"]["mean_sharpe"].iloc[0] if "strategy_key" in summary.columns and len(summary[summary["strategy_key"] == "index"]) > 0 else 0
            _gpt_beat = (_gpt_runs["sharpe_ratio"].dropna() > _idx_sharpe).mean() * 100 if _idx_sharpe else 0
        kpi_card("GPT Beat Rate", fmtp(_gpt_beat, 0), GREEN if _gpt_beat > 50 else RED, "vs market index")

    _pl_ov = D.get("postloss", pd.DataFrame())
    _pl_need = ["prompt_type", "avg_turnover_after_loss", "avg_turnover_after_non_loss", "pct_rebalances_after_loss"]
    _pl_ov_ok = len(_pl_ov) > 0 and all(c in _pl_ov.columns for c in _pl_need)
    if _pl_ov_ok:
        st.caption(
            f"Post-loss rebalancing: **{len(_pl_ov)}** row(s) loaded — **Tests & risk → Behavior** "
            "(**Post-Loss Analysis** from runs + **Post-Loss Rebalancing** from sheet)."
        )
    elif len(_pl_ov) > 0:
        st.caption(
            "Post-loss sheet is present but **required columns are missing** after normalization — see **Data Quality → Sanity Checks**. "
            "**Post-Loss Analysis** (from runs) is still under **Tests & risk → Behavior**."
        )
    else:
        st.caption(
            "Post-loss rebalancing: **no sheet** in this package — add *Post-loss rebalance* (expected columns under **Tests & risk → Behavior**). "
            "**Post-Loss Analysis** (recovery after negative periods) is still computed from **Portfolio runs** there."
        )

    soft_hr()

    # Strategy KPI cards
    if len(summary) > 0:
        section_header("Strategy Performance")
        cols = st.columns(min(6, len(summary)))
        for i, (_, row) in enumerate(summary.iterrows()):
            if i >= 6:
                break
            name = row.get("Strategy", "—")
            sharpe = row.get("mean_sharpe", np.nan)
            ret = row.get("net_return_mean", np.nan)
            n_obs = row.get("n_observations", 0)
            short_name = name.replace("GPT (", "").replace(")", "").replace(" (market-matched)", "").replace(" (buy-and-hold)", "")
            with cols[i]:
                kpi_card(
                    short_name,
                    fmt(sharpe, 2),
                    sharpe_color(sharpe),
                    f"Sharpe | {fmtp(ret * 100 if pd.notna(ret) else np.nan, 1)} ret | n={int(n_obs)}",
                )

    soft_hr()

    # Beat rates
    if len(summary) > 0:
        section_header("Beat Rates")
        st.caption(
            "Bars use each strategy’s **% of run-periods** with Sharpe above the benchmark cell for that market×period. "
            "**GPT (mean of 2 prompts)** is the simple average of Retail and Advanced GPT beat rates when both are in the summary."
        )
        c1, c2 = st.columns(2)
        with c1:
            beat_idx = _summary_beat_rates_with_gpt_pooled_mean(summary, "pct_runs_beating_index_sharpe")
            if len(beat_idx) > 0:
                fig = go.Figure(go.Bar(
                    y=beat_idx["Strategy"],
                    x=beat_idx["pct_runs_beating_index_sharpe"],
                    orientation="h",
                    marker_color=[STRATEGY_COLORS.get(row.get("strategy_key", ""), ACCENT) for _, row in beat_idx.iterrows()],
                    text=[f"{v:.0f}%" for v in beat_idx["pct_runs_beating_index_sharpe"]],
                    textposition="auto",
                    hovertemplate="<b>%{y}</b><br>Beat rate: %{x:.1f}%<extra></extra>",
                ))
                fig.add_vline(x=50, line_dash="dash", line_color="#5E7082", line_width=1,
                              annotation_text="50%", annotation_position="top",
                              annotation_font=dict(color="#5E7082", size=10))
                fig.update_layout(**PLOT_LAYOUT, title="% of runs beating market index (Sharpe)",
                                  xaxis=dict(range=[0, 105]), height=350)
                st.plotly_chart(fig, width="stretch", key="ov_beat_idx")

        with c2:
            beat_60 = _summary_beat_rates_with_gpt_pooled_mean(summary, "pct_runs_beating_sixty_forty_sharpe")
            if len(beat_60) > 0:
                fig = go.Figure(go.Bar(
                    y=beat_60["Strategy"],
                    x=beat_60["pct_runs_beating_sixty_forty_sharpe"],
                    orientation="h",
                    marker_color=[STRATEGY_COLORS.get(row.get("strategy_key", ""), ACCENT) for _, row in beat_60.iterrows()],
                    text=[f"{v:.0f}%" for v in beat_60["pct_runs_beating_sixty_forty_sharpe"]],
                    textposition="auto",
                    hovertemplate="<b>%{y}</b><br>Beat rate: %{x:.1f}%<extra></extra>",
                ))
                fig.add_vline(x=50, line_dash="dash", line_color="#5E7082", line_width=1,
                              annotation_text="50%", annotation_position="top",
                              annotation_font=dict(color="#5E7082", size=10))
                fig.update_layout(**PLOT_LAYOUT, title="% of runs beating 60/40 (Sharpe)",
                                  xaxis=dict(range=[0, 105]), height=350)
                st.plotly_chart(fig, width="stretch", key="ov_beat_6040")

    # Strategy overview table
    if len(summary) > 0:
        section_header("Strategy Summary Table")
        display_cols = ["Strategy", "mean_sharpe", "pct_runs_beating_index_sharpe",
                        "pct_runs_beating_sixty_forty_sharpe", "net_return_mean", "n_observations"]
        available = [c for c in display_cols if c in summary.columns]
        tbl = summary[available].copy()
        rename = {
            "mean_sharpe": "Mean Sharpe",
            "pct_runs_beating_index_sharpe": "Beat Index %",
            "pct_runs_beating_sixty_forty_sharpe": "Beat 60/40 %",
            "net_return_mean": "Mean Return",
            "n_observations": "N",
        }
        tbl.rename(columns=rename, inplace=True)
        for c in ["Mean Sharpe", "Mean Return"]:
            if c in tbl.columns:
                tbl[c] = tbl[c].apply(lambda v: f"{v:.3f}" if pd.notna(v) else "—")
        for c in ["Beat Index %", "Beat 60/40 %"]:
            if c in tbl.columns:
                tbl[c] = tbl[c].apply(lambda v: f"{v:.1f}%" if pd.notna(v) else "—")
        if "N" in tbl.columns:
            tbl["N"] = tbl["N"].apply(lambda v: str(int(v)) if pd.notna(v) else "—")
        st.dataframe(tbl, width="stretch", hide_index=True)

    # Regime overview
    _regime = D.get("regime", pd.DataFrame())
    if len(_regime) > 0:
        soft_hr()
        section_header("Market Regimes")
        st.caption("Macro regime classification per market and period (source: Yahoo Finance, FRED)")

        _regime_mkt_map = {"US": "us", "DE": "germany", "JP": "japan"}
        _regime_display = _regime.copy()
        if market_filter != "All":
            _rev_map = {v: k for k, v in _regime_mkt_map.items()}
            _regime_display = _regime_display[_regime_display["Market"] == _rev_map.get(market_filter, market_filter)]

        _regime_color = {"Bull": GREEN, "Bear": RED, "Flat": "#5E7082",
                         "Low": GREEN, "Elevated": AMBER, "High": RED,
                         "Tightening": RED, "Easing": GREEN, "Stable": "#5E7082", "N/A": "#3B4A5A"}

        def _regime_badge(label):
            c = _regime_color.get(label, "#5E7082")
            return f'<span style="background:{c}22;color:{c};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;">{label}</span>'

        _regime_tbl = _regime_display[["Period", "Market", "Return_%", "Market_Label", "Avg_Vol", "Vol_Label", "Yield_Chg_bp", "Rate_Label"]].copy()
        _regime_tbl = _regime_tbl.rename(columns={
            "Return_%": "Return %", "Market_Label": "Trend", "Avg_Vol": "Avg Vol",
            "Vol_Label": "Vol Regime", "Yield_Chg_bp": "Yield Chg (bp)", "Rate_Label": "Rate Regime",
        })
        for c in ["Return %", "Avg Vol"]:
            if c in _regime_tbl.columns:
                _regime_tbl[c] = _regime_tbl[c].apply(lambda v: f"{v:.1f}" if pd.notna(v) else "—")
        if "Yield Chg (bp)" in _regime_tbl.columns:
            _regime_tbl["Yield Chg (bp)"] = _regime_tbl["Yield Chg (bp)"].apply(lambda v: f"{v:.0f}" if pd.notna(v) else "—")
        st.dataframe(_regime_tbl, width="stretch", hide_index=True)

        # Compact regime heatmap per market
        _mkts_in_regime = _regime_display["Market"].unique()
        if len(_mkts_in_regime) > 1:
            _rcols = st.columns(len(_mkts_in_regime))
            for _ri, _rmkt in enumerate(_mkts_in_regime):
                with _rcols[_ri]:
                    _rsub = _regime_display[_regime_display["Market"] == _rmkt].sort_values("Period")
                    _badges = " ".join([_regime_badge(r["Market_Label"]) for _, r in _rsub.iterrows()])
                    st.markdown(f"**{_rmkt}** &nbsp; {_badges}", unsafe_allow_html=True)

    # Auto-generated key insights
    if len(summary) > 0 and len(runs) > 0:
        soft_hr()
        section_header("Key Insights")
        _insights = []
        _gpt_rows = summary[summary["strategy_key"].isin(["gpt_retail", "gpt_advanced"])] if "strategy_key" in summary.columns else pd.DataFrame()
        _bench_rows = summary[~summary["strategy_key"].isin(["gpt_retail", "gpt_advanced"])] if "strategy_key" in summary.columns else pd.DataFrame()

        if len(_gpt_rows) > 0 and "mean_sharpe" in _gpt_rows.columns:
            _best_gpt = _gpt_rows.loc[_gpt_rows["mean_sharpe"].idxmax()]
            _best_gpt_name = str(_best_gpt.get("Strategy", "GPT")).replace("GPT (", "").replace(")", "")
            _best_gpt_sr = _best_gpt.get("mean_sharpe", 0)
            if len(_bench_rows) > 0 and "mean_sharpe" in _bench_rows.columns:
                _best_bench = _bench_rows.loc[_bench_rows["mean_sharpe"].idxmax()]
                _best_bench_name = str(_best_bench.get("Strategy", "Benchmark"))
                _best_bench_sr = _best_bench.get("mean_sharpe", 0)
                if pd.notna(_best_gpt_sr) and pd.notna(_best_bench_sr):
                    if _best_gpt_sr > _best_bench_sr:
                        _insights.append(("pos", "GPT outperforms benchmarks",
                            f"<b>{_best_gpt_name}</b> achieves a mean Sharpe of <b>{_best_gpt_sr:.2f}</b>, "
                            f"beating the best benchmark ({_best_bench_name}: {_best_bench_sr:.2f})."))
                    else:
                        _insights.append(("neg", "Benchmarks lead on Sharpe",
                            f"The best benchmark (<b>{_best_bench_name}: {_best_bench_sr:.2f}</b>) "
                            f"outperforms the best GPT strategy ({_best_gpt_name}: {_best_gpt_sr:.2f})."))

        if "pct_runs_beating_index_sharpe" in summary.columns and len(_gpt_rows) > 0:
            for _, _gr in _gpt_rows.iterrows():
                _br = _gr.get("pct_runs_beating_index_sharpe", 0)
                _gn = str(_gr.get("Strategy", "")).replace("GPT (", "").replace(")", "")
                if pd.notna(_br):
                    _t = "pos" if _br > 50 else "warn" if _br > 30 else "neg"
                    _insights.append((_t, f"{_gn}: {_br:.0f}% beat index",
                        f"{'More than half' if _br > 50 else 'Less than half'} of {_gn} runs "
                        f"achieve a higher Sharpe ratio than the market index."))

        if "hhi" in runs.columns and "prompt_type" in runs.columns:
            _gpt_hhi = runs[runs["prompt_type"].isin(["retail", "advanced"])]["hhi"].dropna()
            if len(_gpt_hhi) > 0:
                _mh = _gpt_hhi.mean()
                _t = "warn" if _mh > 0.15 else "pos"
                _insights.append((_t, f"Portfolio concentration: HHI = {_mh:.3f}",
                    f"{'Portfolios tend to be concentrated' if _mh > 0.15 else 'Portfolios are reasonably diversified'} "
                    f"(HHI {'above' if _mh > 0.15 else 'below'} 0.15 threshold)."))

        _ic1, _ic2 = st.columns(2)
        for idx, ins in enumerate(_insights[:4]):
            with _ic1 if idx % 2 == 0 else _ic2:
                insight_card(ins[0], ins[1], ins[2])


# ══════════════════════════════════════════
# PERFORMANCE
# ══════════════════════════════════════════
with tab_performance:
    st.caption("Sharpe and returns, equity curves, and regional GPT vs benchmarks.")
    _pt_sh, _pt_eq, _pt_mk = st.tabs(["Sharpe & returns", "Equity curves", "By market"])
    with _pt_sh:
        if len(summary) > 0:
            section_header("Strategy Comparison")
            c1, c2 = st.columns(2)
            with c1:
                ordered = summary.sort_values("mean_sharpe", ascending=True)
                display_sharpe = ordered["mean_sharpe"].clip(upper=10)
                fig = go.Figure(go.Bar(
                    y=ordered["Strategy"],
                    x=display_sharpe,
                    orientation="h",
                    marker_color=[STRATEGY_COLORS.get(row.get("strategy_key", ""), ACCENT) for _, row in ordered.iterrows()],
                    text=[f"{v:.2f}" for v in ordered["mean_sharpe"]],
                    textposition="auto",
                    hovertemplate="<b>%{y}</b><br>Mean Sharpe: %{x:.3f}<extra></extra>",
                ))
                fig.add_vline(x=0, line_dash="dot", line_color="#5E7082", line_width=0.5)
                fig.update_layout(**PLOT_LAYOUT, title="Mean Sharpe ratio by strategy", height=380)
                st.plotly_chart(fig, width="stretch", key="sr_sharpe_bar")

            with c2:
                ordered_r = summary.sort_values("net_return_mean", ascending=True)
                fig = go.Figure(go.Bar(
                    y=ordered_r["Strategy"],
                    x=ordered_r["net_return_mean"] * 100,
                    orientation="h",
                    marker_color=[STRATEGY_COLORS.get(row.get("strategy_key", ""), ACCENT) for _, row in ordered_r.iterrows()],
                    text=[f"{v*100:.1f}%" for v in ordered_r["net_return_mean"]],
                    textposition="auto",
                    hovertemplate="<b>%{y}</b><br>Mean return: %{x:.2f}%<extra></extra>",
                ))
                fig.add_vline(x=0, line_dash="dot", line_color="#5E7082", line_width=0.5)
                fig.update_layout(**PLOT_LAYOUT, title="Mean semi-annual net return", xaxis_title="Return %", height=380)
                st.plotly_chart(fig, width="stretch", key="sr_return_bar")

        # Sharpe distribution for GPT runs
        if len(runs) > 0 and "sharpe_ratio" in runs.columns and "prompt_type" in runs.columns:
            soft_hr()
            section_header("Sharpe Distribution")
            gpt_runs = runs[runs["prompt_type"].isin(["retail", "advanced"])].copy()
            if len(gpt_runs) > 0:
                fig = go.Figure()
                for pt, color in [("retail", ACCENT), ("advanced", "#FB923C")]:
                    subset = gpt_runs[gpt_runs["prompt_type"] == pt]["sharpe_ratio"].dropna()
                    if len(subset) > 0:
                        fig.add_trace(go.Histogram(
                            x=subset, name=f"GPT ({pt.title()})", marker_color=color,
                            opacity=0.65, nbinsx=30,
                        ))
                fig.add_vline(x=0, line_dash="dash", line_color="#5E7082", line_width=1)
                _sc_b = strat_cells.copy() if len(strat_cells) > 0 else pd.DataFrame()
                if market_filter != "All" and len(_sc_b) > 0 and "market" in _sc_b.columns:
                    _sc_b = _sc_b[_sc_b["market"] == market_filter]
                _sharpe_ref_lines = []
                if len(_sc_b) > 0 and "sharpe" in _sc_b.columns and "strategy_key" in _sc_b.columns:
                    for _sk, _nm, _clr, _ in BENCHMARK_OVERLAY_SPECS:
                        _sub_b = _sc_b[_sc_b["strategy_key"].astype(str) == _sk]["sharpe"].dropna()
                        if len(_sub_b) == 0:
                            continue
                        _mu = float(_sub_b.mean())
                        _sharpe_ref_lines.append({
                            "x": _mu, "color": _clr, "dash": "dot", "width": 2,
                            "text": f"{_nm} μ {_mu:.2f}",
                        })
                for _pt, _clr, _lab in [
                    ("retail", ACCENT, "GPT (Retail)"),
                    ("advanced", "#FB923C", "GPT (Advanced)"),
                ]:
                    _ss = gpt_runs[gpt_runs["prompt_type"] == _pt]["sharpe_ratio"].dropna()
                    if len(_ss) == 0:
                        continue
                    _gm = float(_ss.mean())
                    _sharpe_ref_lines.append({
                        "x": _gm, "color": _clr, "dash": "dash", "width": 2,
                        "text": f"Mean {_lab}: {_gm:.2f}",
                    })
                _sharpe_ref_lines.sort(key=lambda z: z["x"])
                _prev_mu = None
                _stack = 0
                _max_stack = 0
                for _ln in _sharpe_ref_lines:
                    # Wider gap than raw x-distance: long labels overlap unless we stack in paper space.
                    if _prev_mu is not None and abs(_ln["x"] - _prev_mu) < 0.45:
                        _stack += 1
                    else:
                        _stack = 0
                    _ln["paper_y"] = 1.006 + _stack * 0.034
                    _max_stack = max(_max_stack, _stack)
                    _prev_mu = _ln["x"]
                for _ln in _sharpe_ref_lines:
                    fig.add_vline(
                        x=_ln["x"], line_dash=_ln["dash"], line_color=_ln["color"], line_width=_ln["width"],
                    )
                    fig.add_annotation(
                        x=_ln["x"], xref="x", yref="paper", y=_ln["paper_y"],
                        text=_ln["text"], showarrow=False,
                        font=dict(size=10, color=_ln["color"]),
                        xanchor="center",
                    )
                _mrg = dict(PLOT_LAYOUT.get("margin", {}))
                _mrg["t"] = min(140, int(_mrg.get("t", 48) + 28 + _max_stack * 20))
                fig.update_layout(
                    **{k: v for k, v in PLOT_LAYOUT.items() if k != "margin"},
                    title="Distribution of period Sharpe ratios", barmode="overlay",
                    xaxis_title="Sharpe ratio", yaxis_title="Count", margin=_mrg,
                )
                st.caption(
                    "**Dot** vertical lines: mean period Sharpe per **benchmark** (sidebar market filter). "
                    "**Dashed** lines: mean Sharpe for **GPT Retail** and **GPT Advanced** in this histogram. "
                    "Labels above the plot stack when means are close on the Sharpe axis."
                )
                st.plotly_chart(fig, width="stretch", key="pt_sharpe_dist")

        # Period-by-period returns
        if len(periods_data) > 0:
            soft_hr()
            section_header("Period Returns Over Time")
            _pd_keys = set(periods_data["strategy_key"].dropna().astype(str).unique()) if "strategy_key" in periods_data.columns else set()
            strategies_to_show = [s for s, *_ in BENCHMARK_OVERLAY_SPECS if s in _pd_keys]
            if not strategies_to_show:
                strategies_to_show = [s for s in ("index", "sixty_forty", "equal_weight") if s in _pd_keys]
            fig = go.Figure()

            for skey in strategies_to_show:
                subset = periods_data[periods_data["strategy_key"] == skey].copy()
                if len(subset) > 0:
                    agg = subset.groupby("period")["period_return"].mean().reset_index().sort_values("period")
                    _spec = next((x for x in BENCHMARK_OVERLAY_SPECS if x[0] == skey), None)
                    _leg = _spec[1] if _spec else skey.replace("_", " ").title()
                    _clr = _spec[2] if _spec else STRATEGY_COLORS.get(skey, "#5E7082")
                    _dash = _spec[3] if _spec else "dash"
                    fig.add_trace(go.Scatter(
                        x=agg["period"], y=agg["period_return"] * 100,
                        name=_leg,
                        mode="lines+markers", line_shape=SCATTER_LINE_SHAPE,
                        line=dict(color=_clr, dash=_dash, width=1.5),
                        marker=dict(size=4),
                    ))

            # GPT cell averages
            if len(gpt_cells) > 0:
                for pt, label, color in [("retail", "GPT Retail", ACCENT), ("advanced", "GPT Advanced", "#FB923C")]:
                    subset = gpt_cells[gpt_cells["prompt_type"] == pt].copy()
                    if len(subset) > 0:
                        agg = subset.groupby("period")["cell_mean_return"].mean().reset_index().sort_values("period")
                        fig.add_trace(go.Scatter(
                            x=agg["period"], y=agg["cell_mean_return"] * 100,
                            name=label, mode="lines+markers", line_shape=SCATTER_LINE_SHAPE,
                            line=dict(color=color, width=2.5),
                            marker=dict(size=6),
                        ))

            fig.add_hline(y=0, line_dash="dot", line_color="#5E7082", line_width=0.5)
            fig.update_layout(**PLOT_LAYOUT, title="Average period return over time", yaxis_title="Return %")
            st.caption(
                "Each point is the **return for that half-year only** (mean across markets / GPT cells), not cumulative wealth. "
                "The first period is only “flat” if that half-year’s return was ~0%; negative values mean an average loss that period. "
                "For growth from a starting level, use **Equity curves**."
            )
            st.plotly_chart(fig, width="stretch")


    with _pt_eq:
        section_header("Equity Curves — Growth of $1.00")

        eq_data = build_equity_curves(strat_paths)
        gpt_eq = build_gpt_equity_curves(gpt_dd)

        if len(eq_data) > 0:
            markets_available = eq_data["market"].unique()
            for mkt in sorted(markets_available):
                st.markdown(f"##### {MARKET_LABELS.get(mkt, mkt)}")
                mkt_data = eq_data[eq_data["market"] == mkt]

                fig = go.Figure()
                _gpt_eq_mkt = (
                    gpt_eq[gpt_eq["market"] == mkt] if len(gpt_eq) > 0 and "market" in gpt_eq.columns else pd.DataFrame()
                )
                _skip_gpt_path = len(_gpt_eq_mkt) > 0
                for strategy in mkt_data["strategy"].unique():
                    # Avoid double GPT curves: strategy_paths may list gpt_retail / gpt_retrieval / gpt_advanced, etc.
                    if _skip_gpt_path and _strategy_paths_duplicates_gpt_median_overlay(strategy):
                        continue
                    s_data = mkt_data[mkt_data["strategy"] == strategy].copy()
                    color = STRATEGY_COLORS.get(strategy, "#5E7082")
                    label = strategy.replace("_", " ").title()

                    # Skip mean-variance if equity goes above 10x (distorts scale)
                    if strategy == "mean_variance" and s_data["equity"].max() > 10:
                        st.caption(f"Mean-variance excluded (terminal equity: {s_data['equity'].max():.1f}x)")
                        continue

                    fig.add_trace(go.Scatter(
                        x=s_data["period"], y=s_data["equity"],
                        name=label, mode="lines+markers", line_shape=SCATTER_LINE_SHAPE,
                        line=dict(color=color, width=2, dash="dash"),
                        marker=dict(size=4),
                    ))

                # Overlay GPT median equity per prompt type (with P10–P90 band)
                if len(gpt_eq) > 0:
                    gpt_mkt = _gpt_eq_mkt
                    for pt, pt_label, color in [("retail", "GPT Retail (median)", ACCENT),
                                                  ("advanced", "GPT Advanced (median)", "#FB923C")]:
                        pt_data = gpt_mkt[gpt_mkt["prompt"] == pt]
                        if len(pt_data) == 0:
                            continue
                        agg = pt_data.groupby("period")["equity"].agg(
                            ["median", lambda x: x.quantile(0.1), lambda x: x.quantile(0.9)]
                        ).reset_index()
                        agg.columns = ["period", "median", "p10", "p90"]
                        agg = agg.sort_values("period")
                        agg["median"] = pd.to_numeric(agg["median"], errors="coerce")
                        agg["p10"] = pd.to_numeric(agg["p10"], errors="coerce")
                        agg["p90"] = pd.to_numeric(agg["p90"], errors="coerce")
                        agg = agg.dropna(subset=["median"])
                        # NaNs in quantiles break fill="toself" (visible "holes"); single-trajectory periods → band = median
                        agg["p10"] = agg["p10"].fillna(agg["median"])
                        agg["p90"] = agg["p90"].fillna(agg["median"])
                        _lo = np.minimum(agg["p10"].to_numpy(), agg["p90"].to_numpy())
                        _hi = np.maximum(agg["p10"].to_numpy(), agg["p90"].to_numpy())
                        agg["p10"] = _lo
                        agg["p90"] = _hi

                        # Shaded P10–P90 band (across GPT trajectories for this prompt)
                        fig.add_trace(go.Scatter(
                            x=list(agg["period"]) + list(agg["period"][::-1]),
                            y=list(agg["p90"]) + list(agg["p10"][::-1]),
                            fill="toself",
                            fillcolor=color.replace(")", ",0.12)").replace("rgb", "rgba")
                                      if "rgb" in color else f"rgba({int(color[1:3],16)},{int(color[3:5],16)},{int(color[5:7],16)},0.12)",
                            line=dict(width=0), showlegend=False, hoverinfo="skip",
                            name=f"{pt_label.split('(')[0].strip()} P10–P90",
                        ))

                        # Median line
                        fig.add_trace(go.Scatter(
                            x=agg["period"], y=agg["median"],
                            name=pt_label, mode="lines+markers", line_shape=SCATTER_LINE_SHAPE,
                            line=dict(color=color, width=3),
                            marker=dict(size=6),
                            hovertemplate=f"{pt_label}<br>Period: %{{x}}<br>Equity: %{{y:.3f}}<extra></extra>",
                        ))

                fig.add_hline(y=1.0, line_dash="dot", line_color="#5E7082", line_width=0.5)
                fig.update_layout(**PLOT_LAYOUT, title=f"Equity curves - {MARKET_LABELS.get(mkt, mkt)}",
                                  yaxis_title="Growth of 1.00", height=420)
                if _skip_gpt_path:
                    st.caption(
                        "**Solid** lines = **median** cumulative equity ($1 start) across all GPT trajectories for that prompt. "
                        "**Shaded tint** = band from **10th to 90th percentile** across those trajectories at each date (spread of outcomes). "
                        "**Dashed** lines are **benchmark / strategy paths** from the workbook (index, equal weight, etc.) — not extra GPT runs. "
                        "Any `gpt_*` path rows that duplicated this overlay are **hidden** so you do not get two curves per prompt."
                    )
                st.plotly_chart(fig, width="stretch")

        else:
            st.info("No equity path data found in calc_strategy_paths.")



    with _pt_mk:
        section_header("Performance by Market")

        if len(gpt_cells) > 0:
            st.caption(
                "GPT Retail / Advanced lines use **Portfolio runs** only: each point is the mean Sharpe in that market×period×prompt. "
                "**Gaps** mean no runs (or no usable Sharpe) for that prompt in that half-year — benchmark lines still come from **strategy cells**, so they can look continuous while GPT breaks."
            )
            markets_avail = gpt_cells["market"].unique()
            _regime_bm = D.get("regime", pd.DataFrame())
            _mkt_code_bm = {"us": "US", "germany": "DE", "japan": "JP"}
            for mkt in sorted(markets_avail):
                st.markdown(f"##### {MARKET_LABELS.get(mkt, mkt)}")
                _bm_code = _mkt_code_bm.get(mkt, mkt.upper())
                _bm_regime = _regime_bm[_regime_bm["Market"] == _bm_code].sort_values("Period") if len(_regime_bm) > 0 else pd.DataFrame()
                if len(_bm_regime) > 0:
                    _regime_color_bm = {"Bull": GREEN, "Bear": RED, "Flat": "#5E7082"}
                    _bm_badges = " ".join(
                        f'<span style="background:{_regime_color_bm.get(r["Market_Label"], "#3B4A5A")}22;'
                        f'color:{_regime_color_bm.get(r["Market_Label"], "#3B4A5A")};'
                        f'padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;">'
                        f'{r["Period"]} {r["Market_Label"]}</span>'
                        for _, r in _bm_regime.iterrows()
                    )
                    st.markdown(f"<div style='margin-bottom:8px;'>{_bm_badges}</div>", unsafe_allow_html=True)
                mkt_data = gpt_cells[gpt_cells["market"] == mkt].copy()

                fig = go.Figure()

                # GPT lines
                for pt, label, color in [("retail", "GPT Retail", ACCENT), ("advanced", "GPT Advanced", "#FB923C")]:
                    subset = mkt_data[(mkt_data["prompt_type"] == pt) & (mkt_data["valid_run_count"] > 0)]
                    if len(subset) > 0:
                        subset = subset.sort_values("period")
                        fig.add_trace(go.Scatter(
                            x=subset["period"], y=subset["cell_mean_sharpe"],
                            name=label, mode="lines+markers", line_shape=SCATTER_LINE_SHAPE,
                            line=dict(color=color, width=2.5),
                            marker=dict(size=6),
                        ))

                # Benchmark lines
                bench_mkt = benchmarks[benchmarks["market"] == mkt].copy() if len(benchmarks) > 0 else pd.DataFrame()
                strat_mkt = strat_cells[strat_cells["market"] == mkt].copy() if len(strat_cells) > 0 else pd.DataFrame()

                for skey, label, color, dash in BENCHMARK_OVERLAY_SPECS:
                    subset = strat_mkt[strat_mkt["strategy_key"] == skey].sort_values("period") if len(strat_mkt) > 0 else pd.DataFrame()
                    if len(subset) > 0:
                        fig.add_trace(go.Scatter(
                            x=subset["period"], y=subset["sharpe"],
                            name=label, mode="lines+markers", line_shape=SCATTER_LINE_SHAPE,
                            line=dict(color=color, width=1.5, dash=dash),
                            marker=dict(size=3),
                        ))

                fig.add_hline(y=0, line_dash="dot", line_color="#5E7082", line_width=0.5)
                fig.update_layout(**PLOT_LAYOUT, title=f"Period Sharpe - {MARKET_LABELS.get(mkt, mkt)}",
                                  yaxis_title="Sharpe ratio", height=380)
                st.plotly_chart(fig, width="stretch", key=f"mkt_sharpe_{mkt}")

                # Beat rate heatmap for this market
                beat_data = mkt_data[mkt_data["valid_run_count"] > 0].copy()
                if len(beat_data) > 0:
                    c1, c2 = st.columns(2)
                    with c1:
                        fig_b = go.Figure()
                        for pt, label, color in [("retail", "Retail", ACCENT), ("advanced", "Advanced", "#FB923C")]:
                            subset = beat_data[beat_data["prompt_type"] == pt].sort_values("period")
                            if len(subset) > 0 and "beat_index_pct" in subset.columns:
                                fig_b.add_trace(go.Bar(
                                    x=subset["period"], y=subset["beat_index_pct"],
                                    name=label, marker_color=color, opacity=0.8,
                                ))
                        fig_b.add_hline(y=50, line_dash="dash", line_color="#5E7082")
                        fig_b.update_layout(**PLOT_LAYOUT, title="% runs beating index", barmode="group",
                                            yaxis=dict(range=[0, 105]))
                        st.plotly_chart(fig_b, width="stretch", key=f"mkt_beat_idx_{mkt}")

                    with c2:
                        fig_b2 = go.Figure()
                        for pt, label, color in [("retail", "Retail", ACCENT), ("advanced", "Advanced", "#FB923C")]:
                            subset = beat_data[beat_data["prompt_type"] == pt].sort_values("period")
                            if len(subset) > 0 and "beat_sixty_forty_pct" in subset.columns:
                                fig_b2.add_trace(go.Bar(
                                    x=subset["period"], y=subset["beat_sixty_forty_pct"],
                                    name=label, marker_color=color, opacity=0.8,
                                ))
                        fig_b2.add_hline(y=50, line_dash="dash", line_color="#5E7082")
                        fig_b2.update_layout(**PLOT_LAYOUT, title="% runs beating 60/40", barmode="group",
                                             yaxis=dict(range=[0, 105]))
                        st.plotly_chart(fig_b2, width="stretch", key=f"mkt_beat_6040_{mkt}")

        else:
            st.info("No GPT cell data found.")

# ══════════════════════════════════════════
# PORTFOLIOS
# ══════════════════════════════════════════

def _parse_holdings_from_row(row, runs_cols):
    """Extract holdings dict from a run row, trying multiple column formats."""
    import ast, json as _json

    for col in ["weights", "portfolio_weights", "holdings", "portfolio_json", "allocations"]:
        if col in runs_cols:
            raw = row.get(col)
            if pd.isna(raw) if isinstance(raw, float) else (raw is None):
                continue
            try:
                if isinstance(raw, dict):
                    return raw
                if isinstance(raw, str):
                    raw = raw.strip()
                    if raw.startswith("{"):
                        try:
                            return _json.loads(raw)
                        except Exception:
                            return ast.literal_eval(raw)
            except Exception:
                continue

    weight_cols = [c for c in runs_cols if c.startswith("weight_") or c.endswith("_weight")]
    if weight_cols:
        out = {}
        for c in weight_cols:
            val = row.get(c, 0)
            if pd.notna(val) and val > 0.0001:
                label = c.replace("weight_", "").replace("_weight", "")
                out[label] = float(val)
        if out:
            return out

    return None


def _resolve_holdings_for_portfolio(row, runs_cols, runs_long_df, id_col):
    """Prefer long-format holding rows (new export); else JSON / weight_* on the row.

    Deduplicates tickers (takes max weight if a ticker appears twice) and
    normalizes so weights sum to ~1.0 when they clearly exceed it.
    """
    d = None
    if (
        runs_long_df is not None
        and len(runs_long_df) > 0
        and id_col
        and id_col in runs_long_df.columns
        and "holding_ticker" in runs_long_df.columns
        and "holding_weight" in runs_long_df.columns
    ):
        rid = row.get(id_col)
        mkt = row.get("market")
        per = row.get("period")
        if pd.notna(rid) and pd.notna(mkt) and pd.notna(per):
            sub = runs_long_df[
                (runs_long_df[id_col] == rid)
                & (runs_long_df["market"] == mkt)
                & (runs_long_df["period"] == per)
            ]
            if len(sub) > 0:
                d = {}
                for _, hr in sub.iterrows():
                    t = str(hr["holding_ticker"])
                    w = float(hr["holding_weight"]) if pd.notna(hr["holding_weight"]) else 0
                    if w > 0.0001:
                        d[t] = max(d.get(t, 0), w)

    if not d:
        d = _parse_holdings_from_row(row, runs_cols)

    if d:
        total = sum(d.values())
        is_frac = max(d.values()) <= 1.0
        threshold = 1.05 if is_frac else 105
        if total > threshold:
            d = {k: v / total * (1.0 if is_frac else 100.0) for k, v in d.items()}

    return d


def _holdings_pie_bar(holdings_dict, title, colors=COLORS):
    """Render a side-by-side donut + horizontal bar for a holdings dict."""
    import pandas as _pd
    title = str(title)
    w_df = _pd.DataFrame(sorted(holdings_dict.items(), key=lambda x: -x[1]), columns=["Asset", "Weight"])
    is_frac = w_df["Weight"].max() <= 1.0
    multiplier = 100 if is_frac else 1

    top_n = min(15, len(w_df))
    plot_df = w_df.head(top_n)
    others = w_df.iloc[top_n:]["Weight"].sum()

    pie_labels = plot_df["Asset"].tolist()
    pie_vals = plot_df["Weight"].tolist()
    if others > 0.001:
        pie_labels.append("Others")
        pie_vals.append(others)

    c1, c2 = st.columns([1, 1])
    with c1:
        fig = go.Figure(go.Pie(
            labels=pie_labels, values=pie_vals, hole=0.45,
            marker=dict(colors=colors[:len(pie_labels)]),
            textinfo="label+percent", textfont=dict(size=10),
        ))
        fig.update_layout(**PLOT_LAYOUT, title=title, height=420, showlegend=False)
        st.plotly_chart(fig, width="stretch")
    with c2:
        fig = go.Figure(go.Bar(
            y=plot_df["Asset"][::-1],
            x=(plot_df["Weight"] * multiplier)[::-1],
            orientation="h",
            marker_color=colors[:len(plot_df)],
            text=[f"{w * multiplier:.1f}%" for w in plot_df["Weight"]][::-1],
            textposition="auto",
        ))
        fig.update_layout(**PLOT_LAYOUT, title=f"Top holdings — {title}", xaxis_title="Weight %", height=420)
        st.plotly_chart(fig, width="stretch")

    tbl = w_df.copy()
    tbl["Weight (%)"] = tbl["Weight"].apply(lambda v: f"{v * multiplier:.2f}%")
    return tbl


def _reasoning_column_keywords():
    return (
        "reason", "rational", "explanation", "response", "gpt_response",
        "justification", "analysis", "narrative", "thinking", "decision",
        "rationale", "summary", "reasoning_summary", "commentary", "output_text",
        "llm_output", "prompt_response",
    )


def _reasoning_columns_from_names(cols):
    kws = _reasoning_column_keywords()
    return [c for c in cols if any(kw in str(c).lower() for kw in kws)]


def _first_reasoning_from_row(row, reasoning_cols):
    """Return (text, column_name) from a Series or dict-like row."""
    for c in reasoning_cols:
        if hasattr(row, "index") and c not in row.index:
            continue
        t = row.get(c) if hasattr(row, "get") else row[c]
        if pd.notna(t) and str(t).strip() and len(str(t).strip()) > 5:
            return str(t).strip(), c
    return None, None


_POST_LOSS_REASONING_THEMES = (
    ("Loss / drawdown", ("loss", "drawdown", "decline", "negative return", "underperform", "setback")),
    ("Risk / volatility", ("risk", "volatility", "volatile", "uncertain", "downside", "tail")),
    ("Defensive / cautious", ("defensive", "conservative", "cautious", "preserve", "quality", "stable")),
    ("Rebalance / rotate", ("rebalance", "rotate", "shift", "trim", "reduce", "increase allocation", "adjust")),
    ("Recovery / opportunity", ("recover", "bounce", "opportunity", "attractive", "undervalued", "contrarian")),
)


def qualitative_post_loss_reasoning(runs_df: pd.DataFrame, pla: dict):
    """Attach portfolio reasoning text for **post-loss** rows (same scope as ``compute_post_loss_analysis_from_runs``).

    Returns coverage stats, simple theme counts (substring scan), and capped excerpts for the UI / AI profile.
    """
    if not pla or runs_df is None or len(runs_df) == 0:
        return None
    aj = pla.get("after_loss_join")
    if aj is None or len(aj) == 0:
        return None
    id_col = pla.get("id_col")
    if not id_col or id_col not in runs_df.columns:
        return None

    r = runs_df.copy()
    j = aj.copy()
    r["_idm"] = r[id_col].map(lambda x: str(x).strip() if pd.notna(x) else "")
    j["_idm"] = j[id_col].map(lambda x: str(x).strip() if pd.notna(x) else "")
    r["_pk"] = r["period"].map(_canonical_period_key)
    j["_pk"] = j["period"].map(_canonical_period_key)
    merge_on = ["_idm", "_pk"]
    if "market" in j.columns and "market" in r.columns:
        r["_mk"] = r["market"].map(_canonical_market_value)
        j["_mk"] = j["market"].map(_canonical_market_value)
        merge_on.append("_mk")
    try:
        m = r.merge(j[merge_on].drop_duplicates(), on=merge_on, how="inner")
    except Exception:
        return None
    m = m.drop(columns=[c for c in ("_idm", "_pk", "_mk") if c in m.columns], errors="ignore")
    if len(m) == 0:
        return None

    rcols = _reasoning_columns_from_names(m.columns.tolist())
    n_rows = len(m)
    texts_lower = []
    excerpts = []
    n_with = 0
    mean_chars = np.nan

    char_lens = []
    for _, row in m.iterrows():
        txt, rsrc = _first_reasoning_from_row(row, rcols)
        if not txt:
            continue
        n_with += 1
        lc = txt.lower()
        texts_lower.append(lc)
        char_lens.append(len(txt))
        if len(excerpts) < 16:
            excerpts.append({
                "Trajectory": str(row.get(id_col, "")),
                "Market": row.get("market", ""),
                "Period": row.get("period", ""),
                "Prompt": str(row.get("prompt_type", "")),
                "Column": rsrc or "",
                "Chars": len(txt),
                "Excerpt": (txt[:420] + "…") if len(txt) > 420 else txt,
                "_full": txt,
            })
    if char_lens:
        mean_chars = float(np.mean(char_lens))

    theme_counts = {}
    for label, phrases in _POST_LOSS_REASONING_THEMES:
        theme_counts[label] = sum(1 for lc in texts_lower if any(p in lc for p in phrases))

    return {
        "ok": True,
        "reasoning_cols": rcols,
        "n_after_loss_rows": n_rows,
        "n_with_reasoning": n_with,
        "mean_chars_when_present": mean_chars,
        "theme_counts": theme_counts,
        "excerpts": excerpts,
    }


def _holdings_line_items_df(runs_long_df, id_col, rid, mkt, per):
    """One row per line-item stock from long-format Portfolio runs (traceable to Excel)."""
    if runs_long_df is None or len(runs_long_df) == 0 or not id_col or id_col not in runs_long_df.columns:
        return pd.DataFrame()
    if "holding_ticker" not in runs_long_df.columns:
        return pd.DataFrame()
    _per_k = _canonical_period_key(per)
    if not _per_k:
        return pd.DataFrame()
    sub = runs_long_df[
        (runs_long_df[id_col] == rid)
        & (runs_long_df["market"] == mkt)
        & (runs_long_df["period"].map(_canonical_period_key) == _per_k)
    ]
    if len(sub) == 0:
        return pd.DataFrame()

    # Core columns in preferred display order
    known = [
        "holding_rank", "holding_ticker", "holding_name", "holding_sector",
        "holding_asset_class", "holding_weight",
        "holding_entry_price", "holding_current_price",
    ]
    cols = [c for c in known if c in sub.columns]

    # Also pick up any other holding_* columns we haven't explicitly listed
    extra = [c for c in sub.columns if c.startswith("holding_") and c not in cols]
    cols += extra

    if not cols:
        return pd.DataFrame()
    out = sub[cols].copy()
    if "holding_rank" in out.columns:
        out = out.sort_values("holding_rank", na_position="last")
    if "holding_weight" in out.columns:
        mx = pd.to_numeric(out["holding_weight"], errors="coerce").max()
        if pd.notna(mx) and mx <= 1.0:
            out["Weight %"] = pd.to_numeric(out["holding_weight"], errors="coerce") * 100.0
        else:
            out["Weight %"] = pd.to_numeric(out["holding_weight"], errors="coerce")

    # Compute P&L % if both prices are available
    if "holding_entry_price" in out.columns and "holding_current_price" in out.columns:
        entry = pd.to_numeric(out["holding_entry_price"], errors="coerce")
        current = pd.to_numeric(out["holding_current_price"], errors="coerce")
        pnl = ((current - entry) / entry * 100).where(entry > 0)
        out["P&L %"] = pnl

    rename_map = {
        "holding_rank": "Rank",
        "holding_ticker": "Ticker",
        "holding_name": "Name",
        "holding_sector": "Sector",
        "holding_asset_class": "Asset class",
        "holding_weight": "Weight (file)",
        "holding_entry_price": "Entry Price",
        "holding_current_price": "Current Price",
        "holding_return": "Return",
    }
    # Auto-rename any extra holding_* columns
    for c in extra:
        if c not in rename_map:
            rename_map[c] = c.replace("holding_", "").replace("_", " ").title()

    return out.rename(columns=rename_map, errors="ignore")


def _merge_data_audit_into_holdings(hld: pd.DataFrame, audit_df: pd.DataFrame, mkt, per) -> pd.DataFrame:
    """Left-join Data audit stock metrics onto a holdings table (expects ``Ticker`` column)."""
    if hld is None or len(hld) == 0 or "Ticker" not in hld.columns:
        return hld
    if audit_df is None or len(audit_df) == 0 or "ticker" not in audit_df.columns:
        return hld
    _m = _canonical_market_value(mkt)
    _pk = _canonical_period_key(per)
    if not _pk:
        return hld
    ad = audit_df.copy()
    if "market" not in ad.columns or "period" not in ad.columns:
        return hld
    ad["market"] = ad["market"].map(_canonical_market_value)
    ad["_pk"] = ad["period"].map(_canonical_period_key)
    sub = ad[(ad["market"] == _m) & (ad["_pk"] == _pk)].copy()
    if len(sub) == 0:
        return hld
    sub["_tk"] = sub["ticker"].astype(str).str.strip()
    perf_specs = [
        ("trailing_return_6m", "Audit 6m return"),
        ("trailing_vol_6m", "Audit 6m vol"),
        ("trailing_max_drawdown_6m", "Audit 6m max DD"),
        ("dividend_yield", "Audit div yield"),
        ("news_count", "Audit news #"),
        ("price_asof", "Audit price asof"),
    ]
    use_cols = ["_tk"] + [c for c, _ in perf_specs if c in sub.columns]
    slim = sub[use_cols].drop_duplicates(subset=["_tk"], keep="first")
    out = hld.copy()
    out["_tk"] = out["Ticker"].astype(str).str.strip()
    out = out.merge(slim, on="_tk", how="left")
    out = out.drop(columns=["_tk"], errors="ignore")
    ren = {old: new for old, new in perf_specs if old in out.columns}
    return out.rename(columns=ren, errors="ignore")


def _return_as_decimal(x):
    """Interpret a return as a decimal (0.12 = 12%). Values with |v|>1.5 are treated as percent points / 100."""
    if x is None or (isinstance(x, float) and pd.isna(x)):
        return np.nan
    v = pd.to_numeric(x, errors="coerce")
    if pd.isna(v):
        return np.nan
    v = float(v)
    if abs(v) <= 1.5:
        return v
    return v / 100.0


def _holdings_agg_weights_and_file_return(runs_long_df, id_col, rid, mkt, per):
    """One row per ticker: summed weight (fraction) and first non-null holding_return from file (decimal)."""
    if runs_long_df is None or len(runs_long_df) == 0 or not id_col or id_col not in runs_long_df.columns:
        return pd.DataFrame()
    if "holding_ticker" not in runs_long_df.columns or "holding_weight" not in runs_long_df.columns:
        return pd.DataFrame()
    _pk = _canonical_period_key(per)
    if not _pk:
        return pd.DataFrame()
    sub = runs_long_df[
        (runs_long_df[id_col] == rid)
        & (runs_long_df["market"] == mkt)
        & (runs_long_df["period"].map(_canonical_period_key) == _pk)
    ].copy()
    if len(sub) == 0:
        return pd.DataFrame()
    sub["_tk"] = sub["holding_ticker"].astype(str).str.strip()
    rows = []
    for tk, grp in sub.groupby("_tk"):
        wf = pd.to_numeric(grp["holding_weight"], errors="coerce")
        if wf.notna().any() and float(wf.abs().max()) > 1.5:
            wf = wf / 100.0
        sw = float(wf.fillna(0).sum())
        fr = np.nan
        if "holding_return" in grp.columns:
            for v in grp["holding_return"]:
                t = _return_as_decimal(v)
                if pd.notna(t):
                    fr = t
                    break
        rows.append({"ticker": tk, "weight_frac": sw, "file_ret": fr})
    return pd.DataFrame(rows)


def _audit_trailing_return_by_ticker(audit_df, mkt, per):
    """Map ticker → trailing_return_6m as decimal for one market×period."""
    if audit_df is None or len(audit_df) == 0 or "ticker" not in audit_df.columns:
        return {}
    if "trailing_return_6m" not in audit_df.columns:
        return {}
    _m = _canonical_market_value(mkt)
    _pk = _canonical_period_key(per)
    if not _pk:
        return {}
    ad = audit_df.copy()
    ad["market"] = ad["market"].map(_canonical_market_value)
    ad["_pk"] = ad["period"].map(_canonical_period_key)
    sub = ad[(ad["market"] == _m) & (ad["_pk"] == _pk)]
    out = {}
    for _, r in sub.iterrows():
        tk = str(r["ticker"]).strip()
        out[tk] = _return_as_decimal(r.get("trailing_return_6m"))
    return out


def _holdings_weighted_return_breakdown(runs_long_df, id_col, rid, mkt, per, audit_df, portfolio_ret_decimal):
    """Σ (w_i × r_i) vs portfolio period return. r from file holding_return if present else audit 6m trailing."""
    base = _holdings_agg_weights_and_file_return(runs_long_df, id_col, rid, mkt, per)
    if len(base) == 0:
        return pd.DataFrame(), {
            "sum_w": np.nan, "sum_wr": np.nan, "port_r": portfolio_ret_decimal,
            "delta": np.nan, "n_lines": 0, "n_with_ret": 0, "ok": False,
        }
    aud = _audit_trailing_return_by_ticker(audit_df, mkt, per)
    rows = []
    for _, r in base.iterrows():
        tk = r["ticker"]
        w = float(r["weight_frac"])
        src = ""
        ret = np.nan
        if pd.notna(r["file_ret"]):
            ret = float(r["file_ret"])
            src = "File (holding_return)"
        elif tk in aud and pd.notna(aud[tk]):
            ret = float(aud[tk])
            src = "Audit (6m trailing)"
        contrib = (w * ret) if pd.notna(ret) else np.nan
        rows.append({
            "Ticker": tk,
            "Weight (frac)": w,
            "Return source": src or "—",
            "Return (dec)": ret,
            "w × r (dec)": contrib,
        })
    det = pd.DataFrame(rows)
    sum_w = float(det["Weight (frac)"].sum())
    wr_series = pd.to_numeric(det["w × r (dec)"], errors="coerce")
    sum_wr = float(wr_series.sum()) if wr_series.notna().any() else np.nan
    pr = float(portfolio_ret_decimal) if pd.notna(portfolio_ret_decimal) else np.nan
    delta = (sum_wr - pr) if pd.notna(pr) and pd.notna(sum_wr) else np.nan
    meta = {
        "sum_w": sum_w,
        "sum_wr": sum_wr,
        "port_r": pr,
        "delta": delta,
        "n_lines": len(det),
        "n_with_ret": int(det["w × r (dec)"].notna().sum()),
        "ok": True,
    }
    return det, meta


def _format_holdings_math_display(det: pd.DataFrame) -> pd.DataFrame:
    """Human-readable % columns for the calculator table."""
    if det is None or len(det) == 0:
        return det
    out = det.copy()
    if "Weight (frac)" in out.columns:
        out["Weight %"] = out["Weight (frac)"].map(lambda x: f"{x * 100:.2f}%" if pd.notna(x) else "—")
    if "Return (dec)" in out.columns:
        out["Return"] = out["Return (dec)"].map(lambda x: f"{x * 100:.2f}%" if pd.notna(x) else "—")
    if "w × r (dec)" in out.columns:
        out["Contribution %"] = out["w × r (dec)"].map(lambda x: f"{x * 100:.3f}%" if pd.notna(x) else "—")
    drop = [c for c in ("Weight (frac)", "Return (dec)", "w × r (dec)") if c in out.columns]
    return out.drop(columns=drop, errors="ignore")


def _format_holdings_display(df):
    """Format a holdings line-items DataFrame for nice display."""
    disp = df.copy()
    if "Weight %" in disp.columns:
        disp["Weight %"] = disp["Weight %"].map(lambda x: f"{x:.2f}%" if pd.notna(x) else "—")
    if "Entry Price" in disp.columns:
        disp["Entry Price"] = pd.to_numeric(disp["Entry Price"], errors="coerce").map(
            lambda x: f"${x:,.2f}" if pd.notna(x) else "—")
    if "Current Price" in disp.columns:
        disp["Current Price"] = pd.to_numeric(disp["Current Price"], errors="coerce").map(
            lambda x: f"${x:,.2f}" if pd.notna(x) else "—")
    if "P&L %" in disp.columns:
        disp["P&L %"] = disp["P&L %"].map(
            lambda x: f"{x:+.1f}%" if pd.notna(x) else "—")
    if "Return" in disp.columns:
        disp["Return"] = pd.to_numeric(disp["Return"], errors="coerce").map(
            lambda x: f"{x*100:.1f}%" if pd.notna(x) and abs(x) < 5 else (f"{x:.1f}%" if pd.notna(x) else "—"))

    def _fmt_audit_num(s, *, as_pct_frac=True):
        v = pd.to_numeric(s, errors="coerce")
        if as_pct_frac:
            mx = float(v.abs().max()) if v.notna().any() else 0.0
            if pd.notna(mx) and mx <= 1.5:
                return v.map(lambda x: f"{x * 100:.1f}%" if pd.notna(x) else "—")
        return v.map(lambda x: f"{x:.2f}%" if pd.notna(x) else "—")

    for _col in ("Audit 6m return", "Audit 6m vol", "Audit 6m max DD", "Audit div yield"):
        if _col in disp.columns:
            disp[_col] = _fmt_audit_num(disp[_col], as_pct_frac=True)
    if "Audit news #" in disp.columns:
        disp["Audit news #"] = pd.to_numeric(disp["Audit news #"], errors="coerce").map(
            lambda x: f"{int(x)}" if pd.notna(x) else "—"
        )
    if "Audit price asof" in disp.columns:
        _pa = pd.to_numeric(disp["Audit price asof"], errors="coerce")
        disp["Audit price asof"] = _pa.map(lambda x: f"{x:.4f}" if pd.notna(x) else "—")
    return disp


def _traceability_meta_html(row, id_col, sel_run):
    """Key join keys so you can find this row in the Excel `Portfolio runs` sheet."""
    parts = []
    if id_col:
        parts.append(f"<strong>{id_col}:</strong> <span class='val'>{html_std.escape(str(sel_run))}</span>")
    for lab, key in [
        ("Market", "market"),
        ("Period", "period"),
        ("Prompt", "prompt_type"),
        ("Model", "model"),
        ("Portfolio key", "portfolio_key"),
        ("Experiment", "experiment_id"),
        ("Source file", "source_file"),
    ]:
        if key in row.index:
            v = row.get(key)
            if pd.notna(v) and str(v).strip():
                parts.append(f"<strong>{lab}:</strong> <span class='val'>{html_std.escape(str(v))}</span>")
    if not parts:
        return ""
    return '<div class="trace-strip">' + " &nbsp;&middot;&nbsp; ".join(parts) + "</div>"


with tab_portfolios:
    section_header("Portfolio Holdings & Composition")
    st.caption("Inspect what each portfolio holds, individual stocks, reasoning, and how holdings change over time.")

    pf_view = st.tabs([
        "Run Inspector",
        "Stocks & traceability",
        "Concentration & Diversification",
        "Equity Over Time",
    ])

    # ────────────────────────────────────────
    # RUN INSPECTOR — pick any run, see its holdings
    # ────────────────────────────────────────
    with pf_view[0]:
        if len(runs) > 0:
            id_col = _preferred_run_identifier_column(runs.columns)
            has_prompt = "prompt_type" in runs.columns
            gpt_runs = runs[runs["prompt_type"].isin(["retail", "advanced"])].copy() if has_prompt else runs.copy()

            if len(gpt_runs) == 0:
                gpt_runs = runs.copy()

            # Filters
            fc1, fc2, fc3 = st.columns(3)
            with fc1:
                mkts = sorted(gpt_runs["market"].dropna().unique()) if "market" in gpt_runs.columns else []
                sel_ri_mkt = st.selectbox("Market", mkts, key="ri_mkt") if mkts else None
            with fc2:
                pers = sorted(gpt_runs["period"].dropna().unique()) if "period" in gpt_runs.columns else []
                sel_ri_per = st.selectbox("Period", pers, key="ri_per") if pers else None
            with fc3:
                prompts = sorted(gpt_runs["prompt_type"].dropna().unique()) if has_prompt else []
                sel_ri_pt = st.selectbox("Prompt", prompts, key="ri_pt") if prompts else None

            filt = gpt_runs.copy()
            if sel_ri_mkt and "market" in filt.columns:
                filt = filt[filt["market"] == sel_ri_mkt]
            if sel_ri_per and "period" in filt.columns:
                filt = filt[filt["period"] == sel_ri_per]
            if sel_ri_pt and has_prompt:
                filt = filt[filt["prompt_type"] == sel_ri_pt]

            if id_col and len(filt) > 0:
                run_ids = sorted(filt[id_col].dropna().unique())
                sel_run = st.selectbox(f"Select run ({len(run_ids)} available)", run_ids, key="ri_run")
                row = filt[filt[id_col] == sel_run].iloc[0]

                # KPI row for this run
                kc1, kc2, kc3, kc4 = st.columns(4)
                with kc1:
                    sr = row.get("sharpe_ratio", np.nan)
                    kpi_card("Sharpe ratio", fmt(sr, 2), sharpe_color(sr))
                with kc2:
                    nr = row.get("net_return", row.get("period_return_net", row.get("period_return", np.nan)))
                    nr_val = nr * 100 if pd.notna(nr) and abs(nr) < 5 else nr
                    kpi_card("Period return", fmtp(nr_val), GREEN if pd.notna(nr_val) and nr_val > 0 else RED)
                with kc3:
                    hhi_v = row.get("hhi", np.nan)
                    kpi_card("HHI", fmt(hhi_v, 3), AMBER if pd.notna(hhi_v) and hhi_v > 0.15 else GREEN)
                with kc4:
                    nh = row.get("effective_n_holdings", row.get("n_holdings", np.nan))
                    kpi_card("Effective holdings", fmt(nh, 1), ACCENT)

                section_header("Traceability")
                st.caption(
                    "Maps to the same **market × period × run** row group in your "
                    "`Portfolio runs` Excel sheet."
                )
                st.markdown(_traceability_meta_html(row, id_col, sel_run), unsafe_allow_html=True)

                rcols_ri = _reasoning_columns_from_names(list(row.index))
                rtxt, rsrc = _first_reasoning_from_row(row, rcols_ri)
                if rtxt:
                    with st.expander(f"GPT reasoning — `{rsrc}` (this period)", expanded=True):
                        st.text(rtxt)
                elif rcols_ri:
                    st.caption("Reasoning columns present but empty for this row.")

                soft_hr()

                # Parse and show holdings
                holdings = _resolve_holdings_for_portfolio(row, filt.columns.tolist(), runs_long, id_col)
                line_df = _holdings_line_items_df(runs_long, id_col, sel_run, row.get("market"), row.get("period"))
                _audit_pf = D.get("data_audit", pd.DataFrame())
                if len(_audit_pf) > 0 and len(line_df) > 0:
                    line_df = _merge_data_audit_into_holdings(line_df, _audit_pf, row.get("market"), row.get("period"))

                _hc1, _hc2 = st.columns([3, 2])
                with _hc1:
                    if len(line_df) > 0:
                        section_header(f"Individual Stocks ({len(line_df)})")
                        if "Audit 6m return" in line_df.columns:
                            st.caption("**Audit** columns: trailing return / vol / drawdown / dividend / news count from **Data audit** (same market × period × ticker).")
                        disp = _format_holdings_display(line_df)
                        st.dataframe(disp, width="stretch", hide_index=True, height=min(400, 35 * len(disp) + 38))
                    elif not holdings:
                        st.info(
                            "No per-asset weight data found. "
                            "Ensure the `Portfolio runs` or `Portfolio holdings` sheet has "
                            "`holding_ticker` and `holding_weight` columns."
                        )

                with _hc2:
                    if holdings:
                        _wsum = sum(holdings.values())
                        _is_frac = max(holdings.values()) <= 1.0
                        _wsum_pct = _wsum * 100 if _is_frac else _wsum
                        if _wsum_pct > 110:
                            st.warning(
                                f"Weights sum to **{_wsum_pct:.1f}%** (expected ~100%). "
                                f"This may mean the data combines multiple periods. "
                                f"Select a specific **period** in the filter above to see a single portfolio."
                            )
                        section_header(f"Weights Chart ({len(holdings)} assets)")
                        tbl = _holdings_pie_bar(holdings, sel_run)
                        with st.expander("Full weights table", expanded=False):
                            st.dataframe(tbl[["Asset", "Weight (%)"]], width="stretch", hide_index=True)

                # Show all run fields as expandable detail
                with st.expander("All run fields (raw row from Portfolio runs)", expanded=False):
                    detail = pd.DataFrame({"Field": row.index, "Value": [str(v) for v in row.values]})
                    st.dataframe(detail, width="stretch", hide_index=True)

                # Compare two runs side-by-side
                soft_hr()
                section_header("Compare Two Portfolios")
                cc1, cc2 = st.columns(2)
                with cc1:
                    sel_cmp_a = st.selectbox("Portfolio A", run_ids, index=0, key="ri_cmp_a")
                with cc2:
                    sel_cmp_b = st.selectbox("Portfolio B", run_ids, index=min(1, len(run_ids) - 1), key="ri_cmp_b")

                row_a = filt[filt[id_col] == sel_cmp_a].iloc[0]
                row_b = filt[filt[id_col] == sel_cmp_b].iloc[0]
                h_a = _resolve_holdings_for_portfolio(row_a, filt.columns.tolist(), runs_long, id_col)
                h_b = _resolve_holdings_for_portfolio(row_b, filt.columns.tolist(), runs_long, id_col)

                if h_a and h_b:
                    all_assets = sorted(set(list(h_a.keys()) + list(h_b.keys())))
                    is_frac = max(max(h_a.values()), max(h_b.values())) <= 1.0
                    mul = 100 if is_frac else 1

                    cmp_df = pd.DataFrame({
                        "Asset": all_assets,
                        "PF A": [h_a.get(a, 0) * mul for a in all_assets],
                        "PF B": [h_b.get(a, 0) * mul for a in all_assets],
                    })
                    cmp_df["Diff"] = cmp_df["PF B"] - cmp_df["PF A"]
                    cmp_df = cmp_df.sort_values("PF A", ascending=False)

                    fig = go.Figure()
                    fig.add_trace(go.Bar(
                        y=cmp_df["Asset"][:15][::-1], x=cmp_df["PF A"][:15][::-1],
                        name=str(sel_cmp_a)[:20], orientation="h", marker_color=ACCENT, opacity=0.8,
                    ))
                    fig.add_trace(go.Bar(
                        y=cmp_df["Asset"][:15][::-1], x=cmp_df["PF B"][:15][::-1],
                        name=str(sel_cmp_b)[:20], orientation="h", marker_color="#FB923C", opacity=0.8,
                    ))
                    fig.update_layout(**PLOT_LAYOUT, title="Portfolio comparison — top 15 assets", barmode="group",
                                      xaxis_title="Weight %", height=480)
                    st.plotly_chart(fig, width="stretch")

                    only_a = [a for a in all_assets if h_a.get(a, 0) > 0.001 and h_b.get(a, 0) <= 0.001]
                    only_b = [a for a in all_assets if h_b.get(a, 0) > 0.001 and h_a.get(a, 0) <= 0.001]
                    shared = [a for a in all_assets if h_a.get(a, 0) > 0.001 and h_b.get(a, 0) > 0.001]
                    mc1, mc2, mc3 = st.columns(3)
                    with mc1:
                        kpi_card("Only in A", str(len(only_a)), ACCENT, ", ".join(only_a[:5]))
                    with mc2:
                        kpi_card("Shared", str(len(shared)), GREEN)
                    with mc3:
                        kpi_card("Only in B", str(len(only_b)), "#FB923C", ", ".join(only_b[:5]))
                elif not h_a and not h_b:
                    st.info("No per-asset weight data available for comparison.")

                # ── Compare selected portfolios vs benchmarks ──
                soft_hr()
                section_header("Compare vs Benchmarks")

                _bench_pd = D.get("periods_data", pd.DataFrame())
                _bench_sc = D.get("strategy_cells", pd.DataFrame())
                _sel_mkt = row_a.get("market") if pd.notna(row_a.get("market")) else None
                _sel_per = row_a.get("period") if pd.notna(row_a.get("period")) else None

                _bench_names = {
                    "index": "Index",
                    "sixty_forty": "60/40",
                    "equal_weight": "Equal Weight",
                    "mean_variance": "Mean-Var",
                    "fama_french": "Fama-French",
                }

                if _sel_mkt and _sel_per:
                    _cmp_rows = []

                    for _label, _rid, _rrow in [
                        (f"PF {sel_cmp_a}", sel_cmp_a, row_a),
                        (f"PF {sel_cmp_b}", sel_cmp_b, row_b),
                    ]:
                        _sr = _rrow.get("sharpe_ratio", np.nan)
                        _ret = _rrow.get("net_return", _rrow.get("period_return_net", _rrow.get("period_return", np.nan)))
                        _hhi_v = _rrow.get("hhi", np.nan)
                        _nh = _rrow.get("effective_n_holdings", _rrow.get("n_holdings", np.nan))
                        _cmp_rows.append({
                            "Strategy": _label,
                            "Sharpe": _sr if pd.notna(_sr) else np.nan,
                            "Return": _ret if pd.notna(_ret) else np.nan,
                            "HHI": _hhi_v if pd.notna(_hhi_v) else np.nan,
                            "Eff. Holdings": _nh if pd.notna(_nh) else np.nan,
                        })

                    for _skey, _bname in _bench_names.items():
                        _b_ret = np.nan
                        _b_sr = np.nan
                        if len(_bench_pd) > 0 and "strategy_key" in _bench_pd.columns:
                            _bm = _bench_pd[
                                (_bench_pd["strategy_key"] == _skey)
                                & (_bench_pd["market"] == _sel_mkt)
                                & (_bench_pd["period"] == _sel_per)
                            ]
                            if len(_bm) > 0:
                                _b_ret = _bm.iloc[0].get("period_return", np.nan)
                        if len(_bench_sc) > 0 and "strategy_key" in _bench_sc.columns:
                            _bs = _bench_sc[
                                (_bench_sc["strategy_key"] == _skey)
                                & (_bench_sc["market"] == _sel_mkt)
                                & (_bench_sc["period"] == _sel_per)
                            ]
                            if len(_bs) > 0:
                                _b_sr = _bs.iloc[0].get("sharpe", np.nan)

                        if pd.notna(_b_ret) or pd.notna(_b_sr):
                            _cmp_rows.append({
                                "Strategy": _bname,
                                "Sharpe": _b_sr,
                                "Return": _b_ret,
                                "HHI": np.nan,
                                "Eff. Holdings": np.nan,
                            })

                    if len(_cmp_rows) > 2:
                        _cmp_df = pd.DataFrame(_cmp_rows)

                        _bar_fig = go.Figure()
                        _bench_color_map = {"Index": AMBER, "60/40": "#5E7082", "Equal Weight": CYAN, "Mean-Var": PURPLE, "Fama-French": "#818CF8"}
                        _bar_colors = [ACCENT, "#FB923C"] + [_bench_color_map.get(r["Strategy"], "#5E7082") for _, r in _cmp_df.iloc[2:].iterrows()]
                        if "Sharpe" in _cmp_df.columns:
                            _bar_fig.add_trace(go.Bar(
                                x=_cmp_df["Strategy"], y=_cmp_df["Sharpe"],
                                name="Sharpe", marker_color=_bar_colors[:len(_cmp_df)],
                            ))
                        _bar_fig.update_layout(
                            **PLOT_LAYOUT,
                            title=f"Sharpe comparison \u2014 {_sel_mkt} / {_sel_per}",
                            yaxis_title="Sharpe Ratio", height=380,
                        )
                        st.plotly_chart(_bar_fig, width="stretch", key="bench_sharpe_cmp")

                        _disp = _cmp_df.copy()
                        for _c in ["Sharpe", "HHI"]:
                            if _c in _disp.columns:
                                _disp[_c] = _disp[_c].apply(lambda v: f"{v:.3f}" if pd.notna(v) else "\u2014")
                        if "Return" in _disp.columns:
                            _disp["Return"] = _disp["Return"].apply(
                                lambda v: f"{v*100:.2f}%" if pd.notna(v) and abs(v) < 5 else (f"{v:.2f}%" if pd.notna(v) else "\u2014")
                            )
                        if "Eff. Holdings" in _disp.columns:
                            _disp["Eff. Holdings"] = _disp["Eff. Holdings"].apply(lambda v: f"{v:.1f}" if pd.notna(v) else "\u2014")
                        st.dataframe(_disp, width="stretch", hide_index=True)
                    else:
                        st.info(f"No benchmark data available for {_sel_mkt} / {_sel_per}.")
                else:
                    st.info("Select a specific market and period to compare against benchmarks.")

            elif len(filt) > 0:
                st.markdown("##### Filtered runs")
                show_cols = [c for c in ["market", "period", "prompt_type", "model", "sharpe_ratio",
                             "net_return", "hhi", "effective_n_holdings", "n_holdings"] if c in filt.columns]
                st.dataframe(filt[show_cols] if show_cols else filt, width="stretch", hide_index=True)
            else:
                st.info("No runs match the selected filters.")

            # Data availability diagnostic
            with st.expander("Data availability diagnostic", expanded=False):
                _diag_items = [
                    f"**Portfolio runs** (collapsed): {len(runs)} rows, {len(runs.columns)} cols",
                    f"**runs_long** (line-item): {len(runs_long)} rows"
                    + (f", {runs_long['holding_ticker'].nunique()} unique tickers" if len(runs_long) > 0 and "holding_ticker" in runs_long.columns else ""),
                    f"**Portfolio holdings** sheet: {len(D.get('holdings', pd.DataFrame()))} rows",
                ]
                for di in _diag_items:
                    st.markdown(f"- {di}")

                col_info = pd.DataFrame({
                    "Column": runs.columns,
                    "Type": [str(runs[c].dtype) for c in runs.columns],
                    "Non-null": [runs[c].notna().sum() for c in runs.columns],
                    "Example": [str(runs[c].dropna().iloc[0])[:80] if runs[c].notna().any() else "—" for c in runs.columns],
                })
                st.dataframe(col_info, width="stretch", hide_index=True)

                if len(runs_long) > 0:
                    st.markdown("**runs_long columns:**")
                    rl_info = pd.DataFrame({
                        "Column": runs_long.columns,
                        "Type": [str(runs_long[c].dtype) for c in runs_long.columns],
                        "Non-null": [runs_long[c].notna().sum() for c in runs_long.columns],
                    })
                    st.dataframe(rl_info, width="stretch", hide_index=True)
        else:
            st.info("No portfolio runs data found.")

    # ────────────────────────────────────────
    # STOCKS & TRACEABILITY (line items = Excel rows)
    # ────────────────────────────────────────
    with pf_view[1]:
        section_header("By Stock — Cross-Portfolio View")
        _rl_src = "Portfolio holdings" if (
            len(D.get("holdings", pd.DataFrame())) > 0
            and len(runs_long) > 0
            and "holding_ticker" in runs_long.columns
            and len(D.get("runs", pd.DataFrame()).get("holding_ticker", pd.Series(dtype=object)).dropna()) == 0
        ) else "Portfolio runs (long format)"
        st.caption(
            f"Source: **`{_rl_src}`** sheet (one row per holding per run×period). "
            "Reasoning text is portfolio-level narrative for that period."
        )
        id_st = None
        if len(runs_long) > 0:
            id_st = next((c for c in ["trajectory_id", "portfolio_key", "run_id", "portfolio_id"] if c in runs_long.columns), None)
        if len(runs_long) == 0 or "holding_ticker" not in runs_long.columns or not id_st:
            st.info(
                "Line-item holdings are not available. Your export needs `holding_ticker` and `holding_weight` "
                "on repeated rows per portfolio period (see `Portfolio runs`)."
            )
        else:
            rl = runs_long.copy()
            tickers = sorted(rl["holding_ticker"].dropna().astype(str).unique())
            c1, c2, c3 = st.columns([2, 1, 1])
            with c1:
                sel_tk = st.selectbox(f"Ticker ({len(tickers)} in data)", tickers, key="trace_ticker")
            with c2:
                mk_ts = ["All"] + sorted(rl["market"].dropna().unique().tolist()) if "market" in rl.columns else ["All"]
                sel_m_ts = st.selectbox("Market", mk_ts, key="trace_mkt")
            with c3:
                pt_ts = ["All"] + sorted(rl["prompt_type"].dropna().unique().tolist()) if "prompt_type" in rl.columns else ["All"]
                sel_pt_ts = st.selectbox("Prompt", pt_ts, key="trace_pt")

            sub = rl[rl["holding_ticker"].astype(str) == str(sel_tk)]
            if sel_m_ts != "All" and "market" in sub.columns:
                sub = sub[sub["market"] == sel_m_ts]
            if sel_pt_ts != "All" and "prompt_type" in sub.columns:
                sub = sub[sub["prompt_type"] == sel_pt_ts]

            show_t = [c for c in [
                id_st, "market", "period", "prompt_type", "model", "holding_rank",
                "holding_weight", "holding_name", "holding_sector", "portfolio_key", "source_file",
            ] if c in sub.columns]
            rsn_ts = _reasoning_columns_from_names(sub.columns.tolist())
            if rsn_ts:
                show_t = show_t + [c for c in rsn_ts if c not in show_t]

            st.markdown(f"**{len(sub)}** line-item row(s) for `{sel_tk}`")
            if len(sub) > 0:
                st.dataframe(sub[show_t], width="stretch", hide_index=True)
                rcol = rsn_ts[0] if rsn_ts else None
                if rcol and sub[rcol].notna().any():
                    with st.expander("Reasoning (same for all lines of that run×period — first non-empty)", expanded=False):
                        ex = sub[sub[rcol].notna() & (sub[rcol].astype(str).str.len() > 20)]
                        if len(ex) > 0:
                            st.text(str(ex.iloc[0][rcol]))
                csv_bytes = sub[show_t].to_csv(index=False).encode("utf-8")
                st.download_button(
                    "Download filtered rows (CSV)",
                    data=csv_bytes,
                    file_name=f"traceability_{sel_tk}.csv",
                    mime="text/csv",
                    key="dl_trace_ticker",
                )

            soft_hr()
            section_header("By Run — Full Period Detail")
            rid_list = sorted(rl[id_st].dropna().unique(), key=str)
            sel_trace_run = st.selectbox("Trajectory / run", rid_list, key="trace_run_pick")
            rsub = rl[rl[id_st] == sel_trace_run].copy()
            ret_col_trace = next((c for c in ["net_return", "period_return_net", "period_return"] if c in runs.columns), None) if len(runs) > 0 else None
            _audit_tr = D.get("data_audit", pd.DataFrame())
            if "period" in rsub.columns and id_st and ret_col_trace and id_st in runs.columns:
                section_header("Holdings return math vs portfolio (this run)")
                st.caption(
                    "**Σ (weight × return)** vs collapsed **period return** for the same trajectory. "
                    "Stock returns prefer **holding_return**, else **audit** 6m trailing — see Run Explorer for details."
                )
                _ms_tr = []
                for _per_tr in sorted(rsub["period"].dropna().unique(), key=str):
                    _mkt_tr = rsub[rsub["period"] == _per_tr]["market"].iloc[0] if "market" in rsub.columns else "?"
                    _pr_row = runs[(runs[id_st] == sel_trace_run) & (runs["market"] == _mkt_tr) & (runs["period"] == _per_tr)]
                    _pr_dec_tr = _return_as_decimal(_pr_row.iloc[0][ret_col_trace]) if len(_pr_row) > 0 else np.nan
                    _, _meta_tr = _holdings_weighted_return_breakdown(
                        rl, id_st, sel_trace_run, _mkt_tr, _per_tr, _audit_tr, _pr_dec_tr
                    )
                    _sw_t, _swr_t, _dlt_t = _meta_tr.get("sum_w"), _meta_tr.get("sum_wr"), _meta_tr.get("delta")
                    _ms_tr.append({
                        "Period": _per_tr,
                        "Market": _mkt_tr,
                        "Σ weights": f"{_sw_t * 100:.2f}%" if _meta_tr.get("ok") and pd.notna(_sw_t) else "—",
                        "Σ(w·r)": f"{_swr_t * 100:.2f}%" if _meta_tr.get("ok") and _meta_tr.get("n_with_ret", 0) > 0 and pd.notna(_swr_t) else "—",
                        "Portfolio": f"{_pr_dec_tr * 100:.2f}%" if pd.notna(_pr_dec_tr) else "—",
                        "Δ (pp)": f"{_dlt_t * 100:.2f}" if _meta_tr.get("ok") and pd.notna(_dlt_t) else "—",
                        "# lines": _meta_tr.get("n_lines", 0),
                        "# w/ret": _meta_tr.get("n_with_ret", 0),
                    })
                if _ms_tr:
                    st.dataframe(pd.DataFrame(_ms_tr), width="stretch", hide_index=True)

            if "period" in rsub.columns:
                for per in sorted(rsub["period"].dropna().unique(), key=str):
                    mkt_one = rsub[rsub["period"] == per]["market"].iloc[0] if "market" in rsub.columns else "?"
                    blk = rsub[rsub["period"] == per]
                    with st.expander(f"`{sel_trace_run}` · {mkt_one} · **{per}** — {len(blk)} stocks", expanded=False):
                        ld = _holdings_line_items_df(rl, id_st, sel_trace_run, mkt_one, per)
                        if len(_audit_tr) > 0 and len(ld) > 0:
                            ld = _merge_data_audit_into_holdings(ld, _audit_tr, mkt_one, per)
                        if len(ld) > 0:
                            if "Audit 6m return" in ld.columns:
                                st.caption("**Data audit** metrics (6m return, vol, max DD, div yield, news) joined on ticker.")
                            st.dataframe(_format_holdings_display(ld), width="stretch", hide_index=True)
                            if ret_col_trace and id_st in runs.columns:
                                _pr_r = runs[(runs[id_st] == sel_trace_run) & (runs["market"] == mkt_one) & (runs["period"] == per)]
                                _pr_d = _return_as_decimal(_pr_r.iloc[0][ret_col_trace]) if len(_pr_r) > 0 else np.nan
                                det_tr, meta_tr = _holdings_weighted_return_breakdown(
                                    rl, id_st, sel_trace_run, mkt_one, per, _audit_tr, _pr_d
                                )
                                if meta_tr.get("ok") and meta_tr.get("n_lines", 0) > 0:
                                    st.markdown("**Weighted return breakdown**")
                                    st.dataframe(_format_holdings_math_display(det_tr), width="stretch", hide_index=True)
                                    _b_tr = []
                                    if pd.notna(meta_tr.get("sum_w")):
                                        _b_tr.append(f"Σ weights = **{meta_tr['sum_w'] * 100:.2f}%**")
                                    if meta_tr.get("n_with_ret", 0) > 0 and pd.notna(meta_tr.get("sum_wr")):
                                        _b_tr.append(f"Σ(w·r) = **{meta_tr['sum_wr'] * 100:.3f}%**")
                                    if pd.notna(meta_tr.get("port_r")):
                                        _b_tr.append(f"Portfolio period = **{meta_tr['port_r'] * 100:.3f}%**")
                                    if pd.notna(meta_tr.get("delta")):
                                        _b_tr.append(f"Δ = **{meta_tr['delta'] * 100:.3f}** pp")
                                    if _b_tr:
                                        st.caption(" · ".join(_b_tr))
                        rcols_b = _reasoning_columns_from_names(blk.columns.tolist())
                        rt, rs = _first_reasoning_from_row(blk.iloc[0], rcols_b) if len(blk) else (None, None)
                        if rt:
                            st.caption(f"Reasoning (`{rs}`)")
                            st.text(rt)

    # ────────────────────────────────────────
    # CONCENTRATION & DIVERSIFICATION
    # ────────────────────────────────────────
    with pf_view[2]:
        if len(runs) > 0 and "period" in runs.columns:
            has_prompt = "prompt_type" in runs.columns
            gpt_r = runs[runs["prompt_type"].isin(["retail", "advanced"])].copy() if has_prompt else runs.copy()

            # HHI and effective N over time
            if "hhi" in gpt_r.columns or "effective_n_holdings" in gpt_r.columns:
                mkt_sel_div = None
                if "market" in gpt_r.columns:
                    mkt_sel_div = st.selectbox("Market", ["All"] + sorted(gpt_r["market"].dropna().unique().tolist()), key="div_mkt")
                    if mkt_sel_div != "All":
                        gpt_r = gpt_r[gpt_r["market"] == mkt_sel_div]

                c1, c2 = st.columns(2)
                with c1:
                    if "hhi" in gpt_r.columns:
                        fig = go.Figure()
                        for pt, color in [("retail", ACCENT), ("advanced", "#FB923C")]:
                            subset = gpt_r[gpt_r["prompt_type"] == pt] if has_prompt else gpt_r
                            if len(subset) > 0 and subset["hhi"].notna().any():
                                agg = subset.groupby("period")["hhi"].agg(["mean", "std"]).reset_index().sort_values("period")
                                fig.add_trace(go.Scatter(
                                    x=agg["period"], y=agg["mean"],
                                    name=pt.title() if has_prompt else "All",
                                    mode="lines", line_shape=SCATTER_LINE_SHAPE,
                                    line=dict(color=color, width=2.5),
                                ))
                                if "std" in agg.columns and agg["std"].notna().any():
                                    fig.add_trace(go.Scatter(
                                        x=list(agg["period"]) + list(agg["period"][::-1]),
                                        y=list(agg["mean"] + agg["std"]) + list((agg["mean"] - agg["std"])[::-1]),
                                        mode="lines",
                                        fill="toself",
                                        fillcolor=color.replace(")", ",0.1)").replace("rgb", "rgba") if "rgb" in color else f"rgba(100,100,100,0.1)",
                                        line=dict(width=0),
                                        marker=dict(size=0),
                                        showlegend=False,
                                        hoverinfo="skip",
                                    ))
                        fig.update_layout(**PLOT_LAYOUT, title="Mean HHI over time (lower = more diversified)", yaxis_title="HHI", height=400)
                        st.caption(
                            "Solid lines = **mean HHI** per half-year. Shaded band = **±1 std** across runs in that period "
                            "(vertex markers on the band are turned off so only the means and fill show)."
                        )
                        st.plotly_chart(fig, width="stretch")

                with c2:
                    if "effective_n_holdings" in gpt_r.columns:
                        fig = go.Figure()
                        for pt, color in [("retail", ACCENT), ("advanced", "#FB923C")]:
                            subset = gpt_r[gpt_r["prompt_type"] == pt] if has_prompt else gpt_r
                            if len(subset) > 0 and subset["effective_n_holdings"].notna().any():
                                agg = subset.groupby("period")["effective_n_holdings"].agg(["mean", "min", "max"]).reset_index().sort_values("period")
                                fig.add_trace(go.Scatter(
                                    x=agg["period"], y=agg["mean"],
                                    name=pt.title() if has_prompt else "All",
                                    mode="lines", line_shape=SCATTER_LINE_SHAPE,
                                    line=dict(color=color, width=2.5),
                                ))
                                fig.add_trace(go.Scatter(
                                    x=list(agg["period"]) + list(agg["period"][::-1]),
                                    y=list(agg["max"]) + list(agg["min"][::-1]),
                                    mode="lines",
                                    fill="toself",
                                    fillcolor=f"rgba(100,100,100,0.1)",
                                    line=dict(width=0),
                                    marker=dict(size=0),
                                    showlegend=False,
                                    hoverinfo="skip",
                                ))
                        fig.update_layout(**PLOT_LAYOUT, title="Effective number of holdings", yaxis_title="# holdings", height=400)
                        st.plotly_chart(fig, width="stretch")

                # Distribution of HHI
                if "hhi" in gpt_r.columns and gpt_r["hhi"].notna().any():
                    st.markdown("##### HHI distribution by prompt type")
                    fig = go.Figure()
                    for pt, color in [("retail", ACCENT), ("advanced", "#FB923C")]:
                        subset = gpt_r[gpt_r["prompt_type"] == pt]["hhi"].dropna() if has_prompt else gpt_r["hhi"].dropna()
                        if len(subset) > 0:
                            fig.add_trace(go.Histogram(
                                x=subset, name=pt.title() if has_prompt else "All",
                                marker_color=color, opacity=0.65, nbinsx=25,
                            ))
                    fig.add_vline(x=0.15, line_dash="dash", line_color=AMBER, annotation_text="Concentrated (0.15)",
                                  annotation_position="top right", annotation_font=dict(color=AMBER, size=10))
                    fig.update_layout(**PLOT_LAYOUT, title="HHI distribution across all runs", barmode="overlay",
                                      xaxis_title="HHI", yaxis_title="Count", height=350)
                    st.plotly_chart(fig, width="stretch")

            # Top-N most-held assets (per prompt type when available)
            id_col_div = _preferred_run_identifier_column(gpt_r.columns)

            def _collect_asset_stats(run_df: pd.DataFrame):
                ah, af = {}, {}
                _cols = run_df.columns.tolist()
                for _, r in run_df.iterrows():
                    h = _resolve_holdings_for_portfolio(r, _cols, runs_long, id_col_div)
                    if h:
                        for asset, weight in h.items():
                            ah.setdefault(asset, []).append(weight)
                            af[asset] = af.get(asset, 0) + 1
                return ah, af

            def _plot_top_asset_bars(ah: dict, af: dict, run_count: int, *, chart_key_prefix: str):
                if not ah or run_count <= 0:
                    st.caption("No holdings extracted for this slice (check weights / holdings columns on Portfolio runs).")
                    return
                freq_df = pd.DataFrame([
                    {"Asset": a, "Times held": af[a],
                     "Avg weight": float(np.mean(ah[a])),
                     "Frequency %": af[a] / run_count * 100}
                    for a in af
                ]).sort_values("Times held", ascending=False)

                c1, c2 = st.columns(2)
                with c1:
                    top20 = freq_df.head(20)
                    _xmax = float(top20["Frequency %"].max()) * 1.18 if len(top20) else 10.0
                    fig = go.Figure(go.Bar(
                        y=top20["Asset"][::-1], x=top20["Frequency %"][::-1],
                        orientation="h", marker_color=ACCENT,
                        text=[f"{v:.0f}%" for v in top20["Frequency %"]][::-1],
                        textposition="outside",
                        cliponaxis=False,
                        textfont=dict(size=11, color="#E8EEF7"),
                    ))
                    _mrg_top = {**dict(PLOT_LAYOUT.get("margin", {})), "l": 120, "r": 80, "t": 48, "b": 40}
                    fig.update_layout(
                        **{k: v for k, v in PLOT_LAYOUT.items() if k != "margin"},
                        title="How often each asset appears in portfolios",
                        xaxis_title="% of runs containing asset", height=500,
                        margin=_mrg_top,
                    )
                    fig.update_xaxes(range=[0, max(_xmax, 5.0)])
                    st.plotly_chart(fig, width="stretch", key=f"{chart_key_prefix}_freq")

                with c2:
                    top20_w = freq_df.sort_values("Avg weight", ascending=False).head(20)
                    mul = 100 if top20_w["Avg weight"].max() <= 1 else 1
                    _xw = float((top20_w["Avg weight"] * mul).max()) * 1.15 if len(top20_w) else 10.0
                    fig = go.Figure(go.Bar(
                        y=top20_w["Asset"][::-1], x=(top20_w["Avg weight"] * mul)[::-1],
                        orientation="h", marker_color="#FB923C",
                        text=[f"{v * mul:.1f}%" for v in top20_w["Avg weight"]][::-1],
                        textposition="outside",
                        cliponaxis=False,
                        textfont=dict(size=11, color="#E8EEF7"),
                    ))
                    _mrg_w = {**dict(PLOT_LAYOUT.get("margin", {})), "l": 120, "r": 80, "t": 48, "b": 40}
                    fig.update_layout(
                        **{k: v for k, v in PLOT_LAYOUT.items() if k != "margin"},
                        title="Average weight when held",
                        xaxis_title="Avg weight %", height=500,
                        margin=_mrg_w,
                    )
                    fig.update_xaxes(range=[0, max(_xw, 5.0)])
                    st.plotly_chart(fig, width="stretch", key=f"{chart_key_prefix}_w")

                with st.expander("Full asset frequency table"):
                    show_freq = freq_df.copy()
                    show_freq["Avg weight"] = show_freq["Avg weight"].apply(
                        lambda v: f"{v * 100:.2f}%" if v <= 1 else f"{v:.2f}%"
                    )
                    show_freq["Frequency %"] = show_freq["Frequency %"].apply(lambda v: f"{v:.1f}%")
                    st.dataframe(show_freq, width="stretch", hide_index=True)

            _ah_all, _af_all = _collect_asset_stats(gpt_r)
            if _ah_all:
                soft_hr()
                if has_prompt:
                    section_header("Most Commonly Held Assets")
                    st.caption(
                        "Charts use the **same filtered runs** as above (e.g. market filter). "
                        "**Retail** vs **Advanced** are separate tabs; percentages are **within that prompt’s runs only**."
                    )
                    _t_ret, _t_adv = st.tabs(["Retail", "Advanced"])
                    with _t_ret:
                        _gr = gpt_r[gpt_r["prompt_type"].astype(str).str.lower() == "retail"]
                        _ahr, _afr = _collect_asset_stats(_gr)
                        _plot_top_asset_bars(_ahr, _afr, len(_gr), chart_key_prefix="div_top_retail")
                    with _t_adv:
                        _ga = gpt_r[gpt_r["prompt_type"].astype(str).str.lower() == "advanced"]
                        _aha, _afa = _collect_asset_stats(_ga)
                        _plot_top_asset_bars(_aha, _afa, len(_ga), chart_key_prefix="div_top_advanced")
                else:
                    section_header("Most Commonly Held Assets (across all filtered runs)")
                    _plot_top_asset_bars(_ah_all, _af_all, len(gpt_r), chart_key_prefix="div_top_all")
        else:
            st.info("No portfolio runs data found.")

    # ────────────────────────────────────────
    # EQUITY OVER TIME (per trajectory)
    # ────────────────────────────────────────
    with pf_view[3]:
        # Build equity curves from runs data (always available) and gpt_dd (if available)
        id_col_eq = _preferred_run_identifier_column(runs.columns)
        ret_col_eq = next((c for c in ["net_return", "period_return_net", "period_return"] if c in runs.columns), None)
        has_prompt_eq = "prompt_type" in runs.columns

        can_build_from_runs = len(runs) > 0 and id_col_eq and ret_col_eq and "period" in runs.columns and "market" in runs.columns
        gpt_eq_from_dd = build_gpt_equity_curves(gpt_dd) if len(gpt_dd) > 0 else pd.DataFrame()

        if can_build_from_runs or len(gpt_eq_from_dd) > 0:
            # Determine available markets from both sources
            mkts_from_runs = sorted(runs["market"].dropna().unique()) if can_build_from_runs else []
            mkts_from_dd = sorted(gpt_eq_from_dd["market"].dropna().unique()) if len(gpt_eq_from_dd) > 0 else []
            all_mkts = sorted(set(mkts_from_runs + mkts_from_dd))

            sel_mkt = st.selectbox("Market", all_mkts, key="pf_perf_mkt")

            prompt_filter = st.radio(
                "Filter by prompt", ["All", "Retail", "Advanced"],
                horizontal=True, key="pf_prompt_filter",
            )

            # Build equity from runs by compounding period returns per run
            runs_eq_rows = []
            if can_build_from_runs:
                gpt_runs_eq = runs[runs["market"] == sel_mkt].copy()
                if has_prompt_eq:
                    if prompt_filter == "Retail":
                        gpt_runs_eq = gpt_runs_eq[gpt_runs_eq["prompt_type"].str.lower() == "retail"]
                    elif prompt_filter == "Advanced":
                        gpt_runs_eq = gpt_runs_eq[gpt_runs_eq["prompt_type"].str.lower() == "advanced"]
                    gpt_runs_eq = gpt_runs_eq[gpt_runs_eq["prompt_type"].str.lower().isin(["retail", "advanced"])]

                for rid in gpt_runs_eq[id_col_eq].dropna().unique():
                    r_data = gpt_runs_eq[gpt_runs_eq[id_col_eq] == rid].sort_values("period")
                    if len(r_data) == 0:
                        continue
                    prompt = (
                        str(r_data["prompt_type"].iloc[0]).strip().lower()
                        if has_prompt_eq
                        else "unknown"
                    )
                    cum = (1 + r_data[ret_col_eq].fillna(0)).cumprod()
                    runs_eq_rows.append({"run": str(rid), "prompt": prompt, "period": "Start", "equity": 1.0})
                    for (_, row), eq_val in zip(r_data.iterrows(), cum):
                        runs_eq_rows.append({"run": str(rid), "prompt": prompt, "period": row["period"], "equity": eq_val})

            runs_eq = pd.DataFrame(runs_eq_rows) if runs_eq_rows else pd.DataFrame()
            if len(runs_eq) > 0:
                runs_eq["prompt"] = runs_eq["prompt"].astype(str).str.strip().str.lower()
                runs_eq = runs_eq[~runs_eq["prompt"].isin(["", "nan", "none"])].copy()
                _pstr = runs_eq["period"].astype(str)
                runs_eq["_psort"] = np.where(_pstr.str.strip().str.lower() == "start", "0", _pstr)
                runs_eq = runs_eq.sort_values(["run", "_psort"]).drop_duplicates(subset=["run", "period"], keep="last")

            n_runs_eq = runs_eq["run"].nunique() if len(runs_eq) > 0 else 0
            prompts_in_data = sorted(runs_eq["prompt"].dropna().unique().tolist()) if len(runs_eq) > 0 else []
            st.caption(f"{n_runs_eq} runs | Prompt types: {', '.join(prompts_in_data) if prompts_in_data else 'none'}")
            show_run_paths = st.checkbox(
                "Show each run as a faint line",
                value=False,
                key="pf_eq_show_run_paths",
                help="Off by default. Turn on to see every trajectory behind the mean.",
            )
            st.caption(
                "**Dashed** curves = benchmarks from strategy paths. **Solid** = mean growth of $1 across GPT runs; "
                "light fill = min–max band across those runs (one line per prompt type after normalizing labels)."
            )

            fig = go.Figure()
            _have_runs_eq = len(runs_eq) > 0

            # Benchmark strategies (skip sheet GPT rows — same curves are built from Portfolio runs above)
            if len(strat_paths) > 0:
                bench_eq = build_equity_curves(strat_paths)
                if len(bench_eq) > 0:
                    bench_mkt = bench_eq[bench_eq["market"] == sel_mkt]
                    for strategy in bench_mkt["strategy"].unique():
                        if _have_runs_eq and str(strategy).lower() in ("gpt_retail", "gpt_advanced", "gpt_unknown"):
                            continue
                        s_data = bench_mkt[bench_mkt["strategy"] == strategy].copy()
                        if strategy == "mean_variance" and s_data["equity"].max() > 10:
                            continue
                        fig.add_trace(go.Scatter(
                            x=s_data["period"], y=s_data["equity"],
                            name=strategy.replace("_", " ").title(),
                            mode="lines", line_shape=SCATTER_LINE_SHAPE,
                            line=dict(color=STRATEGY_COLORS.get(strategy, "#5E7082"), width=2, dash="dash"),
                        ))

            if _have_runs_eq:
                if show_run_paths:
                    for rid in runs_eq["run"].unique():
                        r_data = runs_eq[runs_eq["run"] == rid].sort_values("_psort").copy()
                        prompt = r_data["prompt"].iloc[0] if len(r_data) > 0 else "unknown"
                        color = ACCENT if prompt == "retail" else ("#FB923C" if prompt == "advanced" else "#5E7082")
                        fig.add_trace(go.Scatter(
                            x=r_data["period"], y=r_data["equity"],
                            name=str(rid), mode="lines", line_shape=SCATTER_LINE_SHAPE,
                            line=dict(color=color, width=1),
                            opacity=0.35,
                            showlegend=False,
                            hovertemplate=f"<b>{rid}</b><br>%{{x}}: %{{y:.3f}}<extra></extra>",
                        ))

                prompt_styles = {
                    "retail": ("GPT Retail (mean)", ACCENT),
                    "advanced": ("GPT Advanced (mean)", "#FB923C"),
                }
                for pt in prompts_in_data:
                    label, color = prompt_styles.get(pt, (f"GPT {pt.title()} (mean)", PURPLE))
                    pt_eq = runs_eq[runs_eq["prompt"] == pt]
                    if len(pt_eq) == 0:
                        continue
                    agg = pt_eq.groupby("period")["equity"].agg(["mean", "min", "max"]).reset_index()
                    agg = agg.sort_values("period")

                    try:
                        r, g, b = int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)
                        band_color = f"rgba({r},{g},{b},0.1)"
                    except Exception:
                        band_color = "rgba(100,100,100,0.08)"

                    fig.add_trace(go.Scatter(
                        x=list(agg["period"]) + list(agg["period"][::-1]),
                        y=list(agg["max"]) + list(agg["min"][::-1]),
                        mode="lines",
                        fill="toself",
                        fillcolor=band_color,
                        line=dict(width=0),
                        marker=dict(size=0),
                        showlegend=False,
                        hoverinfo="skip",
                    ))

                    fig.add_trace(go.Scatter(
                        x=agg["period"], y=agg["mean"],
                        name=label,
                        mode="lines", line_shape=SCATTER_LINE_SHAPE,
                        line=dict(color=color, width=3),
                        hovertemplate=f"<b>{label}</b><br>%{{x}}<br>Mean equity: %{{y:.3f}}<extra></extra>",
                    ))

            fig.add_hline(y=1.0, line_dash="dot", line_color="#5E7082", line_width=0.5)
            fig.update_layout(
                **PLOT_LAYOUT,
                title=f"Portfolio equity over time — {MARKET_LABELS.get(sel_mkt, sel_mkt)}",
                yaxis_title="Growth of 1.00", height=480,
            )
            fig.update_layout(legend=dict(font=dict(size=10)))
            st.plotly_chart(fig, width="stretch", key=f"pf_eq_{sel_mkt}")

            # Summary table
            if len(runs_eq) > 0:
                section_header("Run Summary")
                sum_rows = []
                for rid in runs_eq["run"].unique():
                    r_eq = runs_eq[runs_eq["run"] == rid].sort_values("_psort")
                    terminal = r_eq["equity"].iloc[-1] if len(r_eq) > 0 else np.nan
                    prompt = r_eq["prompt"].iloc[0] if len(r_eq) > 0 else "?"
                    sum_rows.append({
                        "Run": rid,
                        "Prompt": prompt.title(),
                        "Terminal Equity": f"{terminal:.3f}" if pd.notna(terminal) else "—",
                        "Total Return": f"{(terminal - 1) * 100:+.1f}%" if pd.notna(terminal) else "—",
                    })
                st.dataframe(pd.DataFrame(sum_rows), width="stretch", hide_index=True)

            runs_eq = runs_eq.drop(columns=["_psort"], errors="ignore")

        else:
            st.info("No portfolio run data found to build equity curves.")


# ══════════════════════════════════════════
# RUN EXPLORER
# ══════════════════════════════════════════
with tab_runs:
    section_header("Run Explorer")
    st.caption("Drill into individual trajectory performance — returns, holdings, and GPT reasoning per period.")

    if len(runs) > 0 and "period" in runs.columns:
        id_col_re = _preferred_run_identifier_column(runs.columns)
        ret_col_re = next((c for c in ["net_return", "period_return_net", "period_return"] if c in runs.columns), None)
        has_prompt_re = "prompt_type" in runs.columns

        # Filters
        re_fc1, re_fc2 = st.columns(2)
        with re_fc1:
            re_mkts = sorted(runs["market"].dropna().unique()) if "market" in runs.columns else []
            re_sel_mkt = st.selectbox("Market", re_mkts, key="re_mkt") if re_mkts else None
        with re_fc2:
            re_prompts = ["All"] + sorted(runs["prompt_type"].dropna().unique().tolist()) if has_prompt_re else ["All"]
            re_sel_prompt = st.selectbox("Prompt type", re_prompts, key="re_prompt")

        filt_re = runs.copy()
        if re_sel_mkt and "market" in filt_re.columns:
            filt_re = filt_re[filt_re["market"] == re_sel_mkt]
        if re_sel_prompt != "All" and has_prompt_re:
            filt_re = filt_re[filt_re["prompt_type"] == re_sel_prompt]

        if id_col_re and ret_col_re and len(filt_re) > 0:
            run_ids_re = sorted(filt_re[id_col_re].dropna().unique())

            # One row per (run, period) — holding-level sheets repeat period; plotting raw rows connects out-of-order x and loops.
            _re_cols = [id_col_re, "period", ret_col_re]
            if has_prompt_re:
                _re_cols.append("prompt_type")
            _re_one = filt_re[_re_cols].copy()
            _re_one["period"] = _re_one["period"].map(_canonical_period_key)
            _re_one = _re_one[_re_one["period"] != ""]
            _agg_map = {ret_col_re: _first_non_null}
            if has_prompt_re:
                _agg_map["prompt_type"] = "first"
            collapsed_re = _re_one.groupby([id_col_re, "period"], as_index=False).agg(_agg_map)
            if has_prompt_re:
                collapsed_re["prompt_type"] = collapsed_re["prompt_type"].astype(str).str.strip().str.lower()

            # ── All runs overlaid ──
            section_header("All Runs — Return Per Period")
            st.caption(
                "Each run uses **one return per half-year** (holding-level duplicates collapsed). "
                "**Linear** segments between periods — no splines — so paths follow time order. Benchmarks: dashed reference."
            )
            show_re_run_lines = st.checkbox(
                "Show faint line for each run",
                value=False,
                key="re_show_all_run_lines",
                help="Off by default — mean-by-prompt + benchmarks are easier to read.",
            )
            fig_all = go.Figure()

            if show_re_run_lines:
                for rid in run_ids_re:
                    r_data = collapsed_re[collapsed_re[id_col_re] == rid].sort_values("period")
                    if len(r_data) < 2:
                        continue
                    ret_vals = r_data[ret_col_re] * 100 if r_data[ret_col_re].abs().max() < 5 else r_data[ret_col_re]
                    prompt = r_data["prompt_type"].iloc[0] if has_prompt_re else "unknown"
                    color = ACCENT if prompt == "retail" else ("#FB923C" if prompt == "advanced" else "#5E7082")
                    fig_all.add_trace(go.Scatter(
                        x=r_data["period"], y=ret_vals,
                        name=str(rid), mode="lines", line_shape="linear",
                        line=dict(color=color, width=1.2),
                        opacity=0.45,
                        showlegend=False,
                        hovertemplate=f"<b>{rid}</b><br>Period: %{{x}}<br>Return: %{{y:.1f}}%<extra></extra>",
                    ))

            # Mean line per prompt type (from collapsed series)
            for pt, color, _dash in [("retail", ACCENT, "solid"), ("advanced", "#FB923C", "solid")]:
                if has_prompt_re and (re_sel_prompt == "All" or str(re_sel_prompt).strip().lower() == pt):
                    pt_data = collapsed_re[collapsed_re["prompt_type"] == pt] if has_prompt_re else collapsed_re
                    if len(pt_data) > 0:
                        mean_ret = pt_data.groupby("period")[ret_col_re].mean().reset_index().sort_values("period")
                        mean_vals = mean_ret[ret_col_re] * 100 if mean_ret[ret_col_re].abs().max() < 5 else mean_ret[ret_col_re]
                        fig_all.add_trace(go.Scatter(
                            x=mean_ret["period"], y=mean_vals,
                            name=f"Mean ({pt.title()})", mode="lines", line_shape="linear",
                            line=dict(color=color, width=3),
                        ))

            if re_sel_mkt and len(periods_data) > 0 and "strategy_key" in periods_data.columns and "period_return" in periods_data.columns:
                _pd_re = periods_data[periods_data["market"] == re_sel_mkt]
                for skey, nm, cl, _ in BENCHMARK_OVERLAY_SPECS:
                    sub_pd = _pd_re[_pd_re["strategy_key"].astype(str) == skey].copy()
                    if len(sub_pd) == 0:
                        continue
                    sub_pd["period"] = sub_pd["period"].map(_canonical_period_key)
                    sub_pd = sub_pd[sub_pd["period"] != ""]
                    ag = sub_pd.groupby("period")["period_return"].mean().reset_index().sort_values("period")
                    prv = ag["period_return"]
                    ybench = prv * 100 if prv.abs().max() < 5 else prv
                    fig_all.add_trace(go.Scatter(
                        x=ag["period"], y=ybench, name=nm, mode="lines", line_shape="linear",
                        line=dict(color=cl, width=2, dash="dash"),
                    ))

            fig_all.add_hline(y=0, line_dash="dot", line_color="#5E7082", line_width=0.5)
            fig_all.update_layout(
                **PLOT_LAYOUT,
                title=f"All runs — return per period | {MARKET_LABELS.get(re_sel_mkt, re_sel_mkt)} | {re_sel_prompt}",
                yaxis_title="Return %", height=480,
            )
            fig_all.update_layout(legend=dict(font=dict(size=10)))
            st.plotly_chart(fig_all, width="stretch", key=f"re_all_{re_sel_mkt}_{re_sel_prompt}")

            soft_hr()

            # ── Individual run selector ──
            section_header("Individual Run Detail")
            re_sel_run = st.selectbox(
                f"Select trajectory / run ({len(run_ids_re)} available)",
                run_ids_re, key="re_sel_run",
            )
            if id_col_re == "trajectory_id":
                st.caption(
                    "Options use **`trajectory_id`** (e.g. `japan_advanced_1`) so holdings match **one** GPT path. "
                    "Plain **`run_id`** repeats across prompts and was merging two portfolios into one table."
                )

            _brd = filt_re[filt_re[id_col_re] == re_sel_run].copy()
            if len(_brd) > 0:
                _brd["period"] = _brd["period"].map(_canonical_period_key)
                _brd = _brd[_brd["period"] != ""]
                _agg_run = {ret_col_re: _first_non_null}
                if "sharpe_ratio" in _brd.columns:
                    _agg_run["sharpe_ratio"] = _first_non_null
                if "hhi" in _brd.columns:
                    _agg_run["hhi"] = _first_non_null
                _nhc_rd = next((c for c in ["n_holdings", "effective_n_holdings", "n_assets", "num_holdings"] if c in _brd.columns), None)
                if _nhc_rd:
                    _agg_run[_nhc_rd] = _first_non_null
                for _c in ("market", "prompt_type"):
                    if _c in _brd.columns:
                        _agg_run[_c] = "first"
                run_data = _brd.groupby("period", as_index=False).agg(_agg_run).sort_values("period")
                run_data = run_data.drop_duplicates(subset=["period"], keep="first")
            else:
                run_data = _brd

            if len(run_data) > 0:
                # KPIs for this run
                n_hold_col = next((c for c in ["n_holdings", "effective_n_holdings", "n_assets", "num_holdings"] if c in run_data.columns), None)

                kc1, kc2, kc3, kc4, kc5 = st.columns(5)
                with kc1:
                    mean_sr = run_data["sharpe_ratio"].mean() if "sharpe_ratio" in run_data.columns else np.nan
                    kpi_card("Avg Sharpe", fmt(mean_sr, 2), sharpe_color(mean_sr))
                with kc2:
                    total_ret = (1 + run_data[ret_col_re].fillna(0)).prod() - 1 if ret_col_re else np.nan
                    total_ret_pct = total_ret * 100 if pd.notna(total_ret) and abs(total_ret) < 50 else total_ret
                    kpi_card("Cumulative return", fmtp(total_ret_pct), GREEN if pd.notna(total_ret_pct) and total_ret_pct > 0 else RED)
                with kc3:
                    n_loss = (run_data[ret_col_re] < 0).sum() if ret_col_re else 0
                    n_total = len(run_data)
                    kpi_card("Loss periods", f"{n_loss}/{n_total}", RED if n_loss > n_total / 2 else GREEN)
                with kc4:
                    avg_n_assets = run_data[n_hold_col].mean() if n_hold_col else np.nan
                    kpi_card("Avg # assets", fmt(avg_n_assets, 1) if pd.notna(avg_n_assets) else "—", CYAN)
                with kc5:
                    mean_hhi = run_data["hhi"].mean() if "hhi" in run_data.columns else np.nan
                    kpi_card("Avg HHI", fmt(mean_hhi, 3), AMBER if pd.notna(mean_hhi) and mean_hhi > 0.15 else GREEN)

                # Return over time chart (line + markers only; bars overlapped benchmarks and read as clutter)
                _ret_ser = pd.to_numeric(run_data[ret_col_re], errors="coerce")
                _scale_r = 100.0 if _ret_ser.abs().max() < 5 else 1.0
                ret_vals = (_ret_ser * _scale_r).tolist()
                marker_colors = [
                    GREEN if pd.notna(v) and v >= 0 else RED if pd.notna(v) else "#5E7082"
                    for v in ret_vals
                ]
                ret_text = [f"{float(v):.1f}%" if pd.notna(v) else "" for v in ret_vals]
                prompt_color_run = ACCENT
                if has_prompt_re and len(run_data) > 0 and "prompt_type" in run_data.columns:
                    prompt_color_run = ACCENT if str(run_data["prompt_type"].iloc[0]).lower() == "retail" else "#FB923C"

                fig_run = go.Figure()
                fig_run.add_trace(go.Scatter(
                    x=run_data["period"], y=ret_vals,
                    name="This run",
                    mode="lines+markers", line_shape="linear",
                    line=dict(color=prompt_color_run, width=3),
                    marker=dict(size=8, color=marker_colors, line=dict(width=1, color="rgba(232,238,247,0.45)")),
                    text=ret_text,
                    textposition="top center",
                    textfont=dict(size=11, color="#C8D4E0"),
                    hovertemplate="Period: %{x}<br>Return: %{y:.1f}%<extra></extra>",
                ))
                _mkt_run = run_data["market"].iloc[0] if "market" in run_data.columns else None
                if _mkt_run and len(periods_data) > 0 and "strategy_key" in periods_data.columns:
                    _pd_one = periods_data[periods_data["market"] == _mkt_run]
                    for skey, nm, cl, _ in BENCHMARK_OVERLAY_SPECS:
                        sub_b = _pd_one[_pd_one["strategy_key"].astype(str) == skey].copy()
                        if len(sub_b) == 0:
                            continue
                        sub_b["_pkey"] = sub_b["period"].map(_canonical_period_key)
                        sub_b = sub_b[sub_b["_pkey"] != ""]
                        _prb = pd.to_numeric(sub_b["period_return"], errors="coerce")
                        _scale_b = 100.0 if _prb.abs().max() < 5 else 1.0
                        agb = sub_b.groupby("_pkey")["period_return"].mean()
                        yb = []
                        for p in run_data["period"]:
                            v = agb.get(p, np.nan)
                            yb.append(float(v) * _scale_b if pd.notna(v) else None)
                        fig_run.add_trace(go.Scatter(
                            x=run_data["period"], y=yb, name=nm, mode="lines", line_shape="linear",
                            line=dict(color=cl, width=2, dash="dash"),
                        ))
                fig_run.add_hline(y=0, line_dash="solid", line_color="#5E7082", line_width=1)
                _ret_mkt = run_data["market"].iloc[0] if "market" in run_data.columns else ""
                _ret_pt = run_data["prompt_type"].iloc[0].title() if has_prompt_re and "prompt_type" in run_data.columns else ""
                _ret_label = " · ".join(filter(None, [str(re_sel_run), MARKET_LABELS.get(_ret_mkt, _ret_mkt), _ret_pt]))
                fig_run.update_layout(
                    **PLOT_LAYOUT,
                    title=f"Period returns — {_ret_label}",
                    yaxis_title="Return %", height=380,
                )
                st.plotly_chart(fig_run, width="stretch")

                # Cumulative equity (run_data is already one row per period)
                _r_cum_ser = pd.to_numeric(run_data[ret_col_re], errors="coerce")
                cum_ret = (1 + _r_cum_ser.fillna(0)).cumprod()
                cum_periods = ["Start"] + run_data["period"].tolist()
                cum_vals = [1.0] + cum_ret.tolist()

                fig_cum = go.Figure()
                prompt_color = ACCENT
                if has_prompt_re and len(run_data) > 0 and "prompt_type" in run_data.columns:
                    prompt_color = ACCENT if str(run_data["prompt_type"].iloc[0]).lower() == "retail" else "#FB923C"
                fig_cum.add_trace(go.Scatter(
                    x=cum_periods, y=cum_vals,
                    mode="lines+markers", line_shape="linear",
                    line=dict(color=prompt_color, width=3), marker=dict(size=7),
                    fill="tozeroy", fillcolor=prompt_color.replace(")", ",0.1)").replace("rgb", "rgba") if "rgb" in prompt_color else "rgba(76,154,255,0.08)",
                    hovertemplate="Period: %{x}<br>Equity: %{y:.3f}<extra></extra>",
                ))
                fig_cum.add_hline(y=1.0, line_dash="dot", line_color="#5E7082", line_width=1)
                _run_mkt = run_data["market"].iloc[0] if "market" in run_data.columns else ""
                _run_pt = run_data["prompt_type"].iloc[0].title() if has_prompt_re and "prompt_type" in run_data.columns else ""
                _run_label = " · ".join(filter(None, [str(re_sel_run), MARKET_LABELS.get(_run_mkt, _run_mkt), _run_pt]))
                fig_cum.update_layout(
                    **PLOT_LAYOUT,
                    title=f"Cumulative equity — {_run_label}",
                    yaxis_title="Growth of $1.00", height=380,
                )
                st.plotly_chart(fig_cum, width="stretch")

                # Sharpe, HHI, and # assets over time
                _periods_run = run_data["period"].tolist()
                metric_cols = st.columns(3)
                with metric_cols[0]:
                    if "sharpe_ratio" in run_data.columns:
                        sr_vals = pd.to_numeric(run_data["sharpe_ratio"], errors="coerce").tolist()
                        sr_colors = [sharpe_color(v) for v in sr_vals]
                        fig_sr = go.Figure(go.Bar(
                            x=list(_periods_run), y=sr_vals,
                            marker_color=sr_colors,
                            text=[f"{float(v):.2f}" if pd.notna(v) else "" for v in sr_vals],
                            textposition="outside",
                        ))
                        fig_sr.add_hline(y=0, line_dash="dot", line_color="#5E7082", line_width=0.5)
                        fig_sr.update_layout(**PLOT_LAYOUT, title="Sharpe ratio per period", yaxis_title="Sharpe", height=320)
                        st.plotly_chart(fig_sr, width="stretch")
                with metric_cols[1]:
                    if n_hold_col and run_data[n_hold_col].notna().any():
                        _nh_y = pd.to_numeric(run_data[n_hold_col], errors="coerce").tolist()
                        fig_nh = go.Figure(go.Bar(
                            x=list(_periods_run), y=_nh_y,
                            marker_color=CYAN,
                            text=[f"{float(v):.0f}" if pd.notna(v) else "" for v in _nh_y],
                            textposition="outside",
                        ))
                        fig_nh.update_layout(**PLOT_LAYOUT, title="# assets per period", yaxis_title="Assets", height=320)
                        st.plotly_chart(fig_nh, width="stretch")
                with metric_cols[2]:
                    if "hhi" in run_data.columns:
                        _hhi_y = pd.to_numeric(run_data["hhi"], errors="coerce").tolist()
                        fig_hhi = go.Figure(go.Scatter(
                            x=list(_periods_run), y=_hhi_y,
                            mode="lines+markers", line_shape="linear",
                            line=dict(color=AMBER, width=2.5), marker=dict(size=6),
                            fill="tozeroy", fillcolor="rgba(251,191,36,0.08)",
                        ))
                        fig_hhi.add_hline(y=0.15, line_dash="dash", line_color=RED, line_width=1,
                                          annotation_text="Concentrated", annotation_font=dict(color=RED, size=9))
                        fig_hhi.update_layout(**PLOT_LAYOUT, title="Concentration (HHI) per period", yaxis_title="HHI", height=320)
                        st.plotly_chart(fig_hhi, width="stretch")

                # Full traceability: line-item holdings + full reasoning per period (no truncation)
                section_header("Holdings & Reasoning by Period")
                st.caption(
                    "Charts use **one row per period** (holding-level duplicates merged). "
                    "Reasoning text is taken from the **first raw row** in that period when multiple holding lines exist."
                )
                reasoning_cols_re = _reasoning_columns_from_names(filt_re.columns.tolist())
                _run_exp = filt_re[filt_re[id_col_re] == re_sel_run].copy()
                _run_exp["_pkey"] = _run_exp["period"].map(_canonical_period_key)
                _audit_for_math = D.get("data_audit", pd.DataFrame())
                if runs_long is not None and len(runs_long) > 0 and id_col_re:
                    section_header("Holdings return math vs portfolio")
                    st.caption(
                        "**Σ (weight × return)** per line item: return from **holding_return** in the file when present, "
                        "else **Data audit** trailing 6m. Compared to the run’s **period return** — definitions and timing differ; "
                        "use as a **sanity check**, not an exact reconciliation."
                    )
                    _math_summary = []
                    for _, _row_m in run_data.iterrows():
                        _per_m = str(_row_m.get("period", "?")).strip()
                        _mkt_m = _row_m.get("market", "?")
                        _ret_m = _row_m.get(ret_col_re, np.nan) if ret_col_re else np.nan
                        _pr_m = _return_as_decimal(_ret_m)
                        _, _meta_m = _holdings_weighted_return_breakdown(
                            runs_long, id_col_re, re_sel_run, _mkt_m, _per_m, _audit_for_math, _pr_m
                        )
                        _sw, _swr, _dlt = _meta_m.get("sum_w"), _meta_m.get("sum_wr"), _meta_m.get("delta")
                        _math_summary.append({
                            "Period": _per_m,
                            "Market": _mkt_m,
                            "Σ weights": f"{_sw * 100:.2f}%" if _meta_m.get("ok") and pd.notna(_sw) else "—",
                            "Σ(w·r)": f"{_swr * 100:.2f}%" if _meta_m.get("ok") and _meta_m.get("n_with_ret", 0) > 0 and pd.notna(_swr) else "—",
                            "Portfolio": f"{_pr_m * 100:.2f}%" if pd.notna(_pr_m) else "—",
                            "Δ (pp)": f"{_dlt * 100:.2f}" if _meta_m.get("ok") and pd.notna(_dlt) else "—",
                            "# lines": _meta_m.get("n_lines", 0),
                            "# w/ret": _meta_m.get("n_with_ret", 0),
                        })
                    if _math_summary:
                        st.dataframe(pd.DataFrame(_math_summary), width="stretch", hide_index=True)

                for _, row_c in run_data.iterrows():
                    per = str(row_c.get("period", "?")).strip()
                    mkt = row_c.get("market", "?")
                    sr_v = row_c.get("sharpe_ratio", np.nan)
                    ret_v = row_c.get(ret_col_re, np.nan) if ret_col_re else np.nan
                    ret_display = f"{ret_v*100:.1f}%" if pd.notna(ret_v) and abs(ret_v) < 5 else (f"{ret_v:.1f}%" if pd.notna(ret_v) else "—")
                    _sub_p = _run_exp[_run_exp["_pkey"] == per] if per and per != "?" else _run_exp.iloc[0:0]
                    row_r = _sub_p.iloc[0] if len(_sub_p) > 0 else row_c
                    mkt = row_r.get("market", mkt)
                    rtxt, rsrc = _first_reasoning_from_row(row_r, reasoning_cols_re)
                    ld_run = _holdings_line_items_df(runs_long, id_col_re, re_sel_run, mkt, per)
                    _audit_re = D.get("data_audit", pd.DataFrame())
                    if len(_audit_re) > 0 and len(ld_run) > 0:
                        ld_run = _merge_data_audit_into_holdings(ld_run, _audit_re, mkt, per)
                    exp_title = f"{per} · {mkt}  |  Return {ret_display}  |  Sharpe {fmt(sr_v, 2)}"
                    with st.expander(exp_title, expanded=False):
                        if len(ld_run) > 0:
                            st.markdown("**Stocks in this portfolio (from file)**")
                            if "Audit 6m return" in ld_run.columns:
                                st.caption(
                                    "**Audit** columns are from the **Data audit** sheet (trailing 6m return, vol, max drawdown, "
                                    "dividend yield, news count, price asof) matched on **market × period × ticker**."
                                )
                            st.dataframe(_format_holdings_display(ld_run), width="stretch", hide_index=True)
                            if id_col_re:
                                det_m, meta_m = _holdings_weighted_return_breakdown(
                                    runs_long, id_col_re, re_sel_run, mkt, per, _audit_for_math,
                                    _return_as_decimal(ret_v) if ret_col_re else np.nan,
                                )
                                if meta_m.get("ok") and meta_m.get("n_lines", 0) > 0:
                                    st.markdown("**Weighted return breakdown**")
                                    st.dataframe(_format_holdings_math_display(det_m), width="stretch", hide_index=True)
                                    _bits_m = []
                                    if pd.notna(meta_m.get("sum_w")):
                                        _bits_m.append(f"Σ weights = **{meta_m['sum_w'] * 100:.2f}%**")
                                    if meta_m.get("n_with_ret", 0) > 0 and pd.notna(meta_m.get("sum_wr")):
                                        _bits_m.append(f"Σ(w·r) = **{meta_m['sum_wr'] * 100:.3f}%**")
                                    if pd.notna(meta_m.get("port_r")):
                                        _bits_m.append(f"Portfolio period = **{meta_m['port_r'] * 100:.3f}%**")
                                    if pd.notna(meta_m.get("delta")):
                                        _bits_m.append(f"Δ = **{meta_m['delta'] * 100:.3f}** pp")
                                    if _bits_m:
                                        st.caption(" · ".join(_bits_m))
                        else:
                            st.caption("No `holding_ticker` line items for this period — check JSON/weight_* on collapsed row if applicable.")
                        if rtxt:
                            st.markdown(f"**Reasoning** (`{rsrc}`) — full text")
                            st.text(rtxt)
                        elif reasoning_cols_re:
                            st.caption("Reasoning columns exist but this period’s cells are empty.")

                # Full run data table
                with st.expander("Full run data table", expanded=False):
                    st.dataframe(run_data, width="stretch", hide_index=True)

            # ── Compare multiple runs ──
            soft_hr()
            section_header("Compare Multiple Runs")
            sel_compare = st.multiselect(
                "Select runs to compare",
                run_ids_re,
                default=run_ids_re[:min(3, len(run_ids_re))],
                key="re_compare",
            )
            if sel_compare and ret_col_re:
                fig_cmp = go.Figure()
                for i, rid in enumerate(sel_compare):
                    r_data = filt_re[filt_re[id_col_re] == rid].sort_values("period")
                    if len(r_data) == 0:
                        continue
                    cum = (1 + r_data[ret_col_re].fillna(0)).cumprod()
                    periods = ["Start"] + r_data["period"].tolist()
                    vals = [1.0] + cum.tolist()
                    color = COLORS[i % len(COLORS)]
                    fig_cmp.add_trace(go.Scatter(
                        x=periods, y=vals,
                        name=str(rid), mode="lines+markers", line_shape=SCATTER_LINE_SHAPE,
                        line=dict(color=color, width=2.5), marker=dict(size=5),
                    ))
                fig_cmp.add_hline(y=1.0, line_dash="dot", line_color="#5E7082", line_width=0.5)
                fig_cmp.update_layout(
                    **PLOT_LAYOUT,
                    title="Cumulative equity comparison",
                    yaxis_title="Growth of 1.00", height=450,
                )
                fig_cmp.update_layout(legend=dict(font=dict(size=9)))
                st.plotly_chart(fig_cmp, width="stretch")

                # Summary table
                n_hold_col_cmp = next((c for c in ["n_holdings", "effective_n_holdings", "n_assets", "num_holdings"] if c in filt_re.columns), None)
                cmp_rows = []
                for rid in sel_compare:
                    r_data = filt_re[filt_re[id_col_re] == rid]
                    total = (1 + r_data[ret_col_re].fillna(0)).prod() - 1
                    avg_sr = r_data["sharpe_ratio"].mean() if "sharpe_ratio" in r_data.columns else np.nan
                    n_loss = (r_data[ret_col_re] < 0).sum()
                    avg_n_assets_cmp = r_data[n_hold_col_cmp].mean() if n_hold_col_cmp else np.nan
                    avg_hhi = r_data["hhi"].mean() if "hhi" in r_data.columns else np.nan
                    cmp_rows.append({
                        "Run": str(rid),
                        "Total Return": f"{total*100:.1f}%" if abs(total) < 50 else f"{total:.1f}%",
                        "Avg Sharpe": f"{avg_sr:.2f}" if pd.notna(avg_sr) else "—",
                        "Loss Periods": f"{n_loss}/{len(r_data)}",
                        "Avg # Assets": f"{avg_n_assets_cmp:.1f}" if pd.notna(avg_n_assets_cmp) else "—",
                        "Avg HHI": f"{avg_hhi:.3f}" if pd.notna(avg_hhi) else "—",
                    })
                st.dataframe(pd.DataFrame(cmp_rows), width="stretch", hide_index=True)
        else:
            st.info("No run ID or return column found in the data.")
    else:
        st.info("No portfolio runs data found.")




# ══════════════════════════════════════════
# BY REGIME (market × macro regime performance)
# ══════════════════════════════════════════
with tab_regime:
    st.markdown("""
<style>
.regime-hero { border: 2px solid #4C9AFF; border-radius: 12px; padding: 14px 18px; margin-bottom: 16px;
  background: linear-gradient(135deg, #0D1B2A 0%, #1A2E4A 100%); box-shadow: 0 0 24px rgba(76,154,255,0.15); }
.regime-pill { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700;
  margin: 2px 6px 2px 0; letter-spacing: 0.03em; }
</style>
""", unsafe_allow_html=True)

    section_header("Performance by Market & Regime")
    st.caption(
        "Main lens: **trend regime** (Bull / Flat / Bear). Regime charts keep the **same three trend buckets** on the axis everywhere "
        "(and the same three vol / rate buckets when you switch X-axis to those), so empty slices show as gaps rather than disappearing. "
        "Start with **GPT vs benchmark portfolios & markets**, then head-to-head and Retail vs Advanced for prompt detail."
    )

    if len(runs) == 0:
        st.info("No portfolio runs loaded.")
    elif "Market_Label" not in runs.columns or runs["Market_Label"].isna().all():
        st.warning(
            "Regime labels are not attached to your runs. Generate `regime_output.xlsx` or `regime_labels_verified.xlsx` "
            "and place it in your **Regime data** folder or next to `app.py` — the dashboard picks the newest file automatically."
        )
    else:
        _ret_rg = next((c for c in ["net_return", "period_return_net", "period_return"] if c in runs.columns), None)
        _gpt_base = runs[runs["prompt_type"].astype(str).str.lower().isin(["retail", "advanced"])].copy()
        _gpt_base = _gpt_base[_gpt_base["Market_Label"].notna()].copy()

        _rg_ref_tab = D.get("regime", pd.DataFrame())
        if len(_rg_ref_tab) == 0 and len(D.get("runs", pd.DataFrame())) > 0 and "Market_Label" in D["runs"].columns:
            _rg_ref_tab = D["runs"][
                ["market", "period", "Market_Label", "Vol_Label", "Rate_Label"]
            ].drop_duplicates()
        _bm_raw = _merge_strategy_cells_with_regime(
            strat_cells.copy() if len(strat_cells) > 0 else pd.DataFrame(),
            _rg_ref_tab,
        )

        _trend_colors = {"Bull": GREEN, "Flat": "#94A3B8", "Bear": RED, "N/A": "#475569"}
        _vol_colors = {"Low": GREEN, "Elevated": AMBER, "High": RED, "N/A": "#475569"}
        _rate_colors = {"Easing": GREEN, "Stable": CYAN, "Tightening": RED, "N/A": "#475569"}
        _bench_meta = {
            "index": ("Market index", AMBER),
            "sixty_forty": ("60/40", "#5E7082"),
            "equal_weight": ("Equal weight", CYAN),
            "mean_variance": ("Mean-variance", PURPLE),
            "fama_french": ("Fama-French", "#818CF8"),
        }

        def _regime_chart_filters(_prefix: str, *, with_model: bool = False):
            with st.expander("Filters — all charts & table on this tab", expanded=False):
                st.caption(
                    "One slice for the whole **By Regime** tab: summary, GPT vs benchmarks, head-to-head, Retail vs Advanced, and the regime table."
                )
                _mopts = sorted(_gpt_base["market"].dropna().unique()) if "market" in _gpt_base.columns else []
                _mdef = _mopts if market_filter == "All" else [m for m in _mopts if m == market_filter]
                if not _mdef:
                    _mdef = _mopts
                _mk = st.multiselect(
                    "Markets",
                    options=_mopts,
                    default=_mdef,
                    format_func=lambda m: MARKET_LABELS.get(m, m),
                    key=f"{_prefix}_mkt",
                    help="Pick at least one region.",
                )
                if not _mk:
                    _mk = _mopts
                _pm = st.selectbox(
                    "Prompt focus",
                    ["Compare both (Retail vs Advanced)", "Retail only", "Advanced only"],
                    key=f"{_prefix}_prompt",
                )
                _p_opts = sorted(_gpt_base["period"].dropna().unique()) if "period" in _gpt_base.columns else []
                _pe = st.multiselect("Periods", options=_p_opts, default=_p_opts, key=f"{_prefix}_per")
                if not _pe:
                    _pe = _p_opts
                _fc1, _fc2, _fc3 = st.columns(3)
                with _fc1:
                    _to_a = sorted(_gpt_base["Market_Label"].dropna().unique(), key=str)
                    _tr = st.multiselect("Trend regimes", options=_to_a, default=_to_a, key=f"{_prefix}_tr")
                with _fc2:
                    _vo_a = (
                        sorted(_gpt_base["Vol_Label"].dropna().unique(), key=str)
                        if "Vol_Label" in _gpt_base.columns
                        else []
                    )
                    _vo = (
                        st.multiselect("Volatility regimes", options=_vo_a, default=_vo_a, key=f"{_prefix}_vo")
                        if _vo_a
                        else []
                    )
                with _fc3:
                    _rt_a = (
                        sorted(_gpt_base["Rate_Label"].dropna().unique(), key=str)
                        if "Rate_Label" in _gpt_base.columns
                        else []
                    )
                    _rt = (
                        st.multiselect("Rate regimes", options=_rt_a, default=_rt_a, key=f"{_prefix}_rt")
                        if _rt_a
                        else []
                    )
                _sel_models = None
                if with_model and "model" in _gpt_base.columns:
                    _mod_opts = sorted(_gpt_base["model"].dropna().astype(str).unique())
                    if _mod_opts:
                        _sel_models = st.multiselect(
                            "LLM model (optional)",
                            options=_mod_opts,
                            default=_mod_opts,
                            key=f"{_prefix}_model",
                        )
                        if not _sel_models:
                            _sel_models = _mod_opts
            _g = _filter_regime_slice(_gpt_base, _mk, _pe, _tr, _vo, _rt)
            _g = _apply_regime_prompt_mode(_g, _pm)
            if with_model and _sel_models is not None and len(_sel_models) > 0 and "model" in _g.columns:
                _g = _g[_g["model"].astype(str).isin(_sel_models)].copy()
            _b = _filter_regime_slice(_bm_raw, _mk, _pe, _tr, _vo, _rt)
            _to, _vo_o, _ro = _regime_axis_orders(_g)
            _cb = _pm == "Compare both (Retail vs Advanced)"
            return _g, _b, _to, _vo_o, _ro, _cb, _pm

        st.markdown(
            '<div class="regime-hero">'
            '<span style="color:#94A3B8;font-size:11px;text-transform:uppercase;letter-spacing:2px;">Regime legend</span><br>'
            '<span class="regime-pill" style="background:#34D39933;color:#34D399;">Trend: Bull</span>'
            '<span class="regime-pill" style="background:#94A3B833;color:#94A3B8;">Flat</span>'
            '<span class="regime-pill" style="background:#F8717133;color:#F87171;">Bear</span>'
            '<span class="regime-pill" style="background:#22D3EE33;color:#22D3EE;">Vol: Low</span>'
            '<span class="regime-pill" style="background:#FBBF2433;color:#FBBF24;">Elevated</span>'
            '<span class="regime-pill" style="background:#F8717133;color:#F87171;">High</span>'
            '<span class="regime-pill" style="background:#34D39933;color:#34D399;">Rate: Easing</span>'
            '<span class="regime-pill" style="background:#22D3EE33;color:#22D3EE;">Stable</span>'
            '<span class="regime-pill" style="background:#F8717133;color:#F87171;">Tightening</span>'
            "</div>",
            unsafe_allow_html=True,
        )

        st.caption(
            "Adjust **Filters** once (below); all charts and the regime table on this tab share the same slice."
        )
        _gpt_rg, _bm_rg, _trend_order, _vol_order, _rate_order, _rg_compare_both, _rg_prompt_mode = _regime_chart_filters(
            "rg_tab", with_model=True
        )

        st.markdown("##### Summary — KPIs & narrative")
        if len(_gpt_rg) == 0:
            st.info("No runs match **Filters**. Open the expander above and widen markets or periods.")
        else:
            # ── Hero KPIs (overall + optional Retail vs Advanced split) ──
            if "sharpe_ratio" in _gpt_rg.columns:
                _by_trend = _gpt_rg.groupby("Market_Label", dropna=False)["sharpe_ratio"].agg(["mean", "count"]).reset_index()
                _by_trend = _by_trend[(_by_trend["count"] > 0) & _by_trend["mean"].notna()]
                if len(_by_trend) > 0:
                    _best = _by_trend.loc[_by_trend["mean"].idxmax()]
                    _worst = _by_trend.loc[_by_trend["mean"].idxmin()]
                    _hc1, _hc2, _hc3, _hc4 = st.columns(4)
                    with _hc1:
                        kpi_card("Strongest trend", str(_best["Market_Label"]), _trend_colors.get(str(_best["Market_Label"]), ACCENT),
                                 f"Mean Sharpe {_best['mean']:.2f} · n={int(_best['count'])}")
                    with _hc2:
                        kpi_card("Weakest trend", str(_worst["Market_Label"]), _trend_colors.get(str(_worst["Market_Label"]), RED),
                                 f"Mean Sharpe {_worst['mean']:.2f} · n={int(_worst['count'])}")
                    with _hc3:
                        _vol_best = _gpt_rg.groupby("Vol_Label")["sharpe_ratio"].mean()
                        if len(_vol_best) > 0:
                            _vb = _vol_best.idxmax()
                            kpi_card("Best vol regime", str(_vb), _vol_colors.get(str(_vb), ACCENT),
                                     f"Mean Sharpe {_vol_best.max():.2f}")
                        else:
                            kpi_card("Best vol regime", "—", "#5E7082", "")
                    with _hc4:
                        _rb = _gpt_rg.groupby("Rate_Label")["sharpe_ratio"].mean()
                        if len(_rb) > 0:
                            _ri = _rb.idxmax()
                            kpi_card("Best rate regime", str(_ri), _rate_colors.get(str(_ri), ACCENT),
                                     f"Mean Sharpe {_rb.max():.2f}")
                        else:
                            kpi_card("Best rate regime", "—", "#5E7082", "")

                if _rg_compare_both and "prompt_type" in _gpt_rg.columns:
                    _pr = _gpt_rg[_gpt_rg["prompt_type"].astype(str).str.lower() == "retail"]["sharpe_ratio"].dropna()
                    _pa = _gpt_rg[_gpt_rg["prompt_type"].astype(str).str.lower() == "advanced"]["sharpe_ratio"].dropna()
                    if len(_pr) > 0 and len(_pa) > 0:
                        _mr, _ma = float(_pr.mean()), float(_pa.mean())
                        _winner = "Retail" if _mr > _ma else "Advanced" if _ma > _mr else "Tie"
                        _wc = ACCENT if _winner == "Retail" else ("#FB923C" if _winner == "Advanced" else "#94A3B8")
                        st.markdown(
                            f'<div style="margin:12px 0;padding:12px 16px;border-radius:10px;border:1px solid #2D3F5A;'
                            f'background:#111D2E;"><span style="color:#94A3B8;font-size:12px;">Prompt comparison (filtered data)</span><br>'
                            f'<span style="font-size:18px;font-weight:700;color:{ACCENT};">Retail</span> '
                            f'<span style="color:#E8EEF7;">μ Sharpe {_mr:.2f}</span>'
                            f' &nbsp;<span style="color:#5E7082;">vs</span>&nbsp; '
                            f'<span style="font-size:18px;font-weight:700;color:#FB923C;">Advanced</span> '
                            f'<span style="color:#E8EEF7;">μ Sharpe {_ma:.2f}</span>'
                            f' &nbsp;·&nbsp; <span style="color:{_wc};font-weight:700;">{_winner} ahead</span>'
                            f' <span style="color:#5E7082;font-size:13px;">(Δ {abs(_mr - _ma):.2f})</span></div>',
                            unsafe_allow_html=True,
                        )

            # ── Executive summary: sample, trend lens, excess vs index, thin buckets ──
            _exec_lines = []
            _n_filt = len(_gpt_rg)
            _exec_lines.append(
                f"<strong>Sample:</strong> {_n_filt} run-period observations with the current filters "
                f"(markets, periods, regime slices, prompt focus)."
            )
            if "sharpe_ratio" in _gpt_rg.columns and _n_filt > 0 and "Market_Label" in _gpt_rg.columns:
                _gbt = _gpt_rg.groupby("Market_Label", dropna=False)["sharpe_ratio"].agg(["mean", "median", "count"])
                _gbt = _gbt[_gbt["count"] > 0]
                if len(_gbt) > 0:
                    _tb = _gbt["mean"].idxmax()
                    _tw = _gbt["mean"].idxmin()
                    _exec_lines.append(
                        f"<strong>Trend lens (GPT Sharpe):</strong> strongest <span style='color:#6EE7B7;'>{_tb}</span> "
                        f"(mean {_gbt.loc[_tb, 'mean']:.2f}, median {_gbt.loc[_tb, 'median']:.2f}, n={int(_gbt.loc[_tb, 'count'])}); "
                        f"weakest <span style='color:#F87171;'>{_tw}</span> "
                        f"(mean {_gbt.loc[_tw, 'mean']:.2f}, n={int(_gbt.loc[_tw, 'count'])})."
                    )
                    _thin_t = _gbt[_gbt["count"] < 5].index.astype(str).tolist()
                    if _thin_t:
                        _exec_lines.append(
                            f"<span style='color:#FBBF24;'><strong>Thin trend buckets (n under 5):</strong> "
                            f"{', '.join(_thin_t)} — interpret means cautiously.</span>"
                        )
            if (
                len(_bm_rg) > 0
                and "index" in set(_bm_rg["strategy_key"].dropna().astype(str))
                and "Market_Label" in _gpt_rg.columns
                and "sharpe_ratio" in _gpt_rg.columns
            ):
                _idx_x = _bm_rg[_bm_rg["strategy_key"].astype(str) == "index"]
                _exc_trend = []
                for _t in _trend_order:
                    _gmu = _gpt_rg[_gpt_rg["Market_Label"].astype(str) == str(_t)]["sharpe_ratio"].mean()
                    _imu = _idx_x[_idx_x["Market_Label"].astype(str) == str(_t)]["sharpe"].mean()
                    if pd.notna(_gmu) and pd.notna(_imu):
                        _exc_trend.append((_t, float(_gmu - _imu)))
                if _exc_trend:
                    _be = max(_exc_trend, key=lambda z: z[1])
                    _we = min(_exc_trend, key=lambda z: z[1])
                    _exec_lines.append(
                        f"<strong>Excess vs market index by trend (μ GPT − μ index):</strong> "
                        f"best <span style='color:#6EE7B7;'>{_be[0]}</span> ({_be[1]:+.2f}); "
                        f"worst <span style='color:#F87171;'>{_we[0]}</span> ({_we[1]:+.2f})."
                    )
            if _ret_rg and _ret_rg in _gpt_rg.columns and "Market_Label" in _gpt_rg.columns:
                _rv = pd.to_numeric(_gpt_rg[_ret_rg], errors="coerce")
                if _rv.notna().any():
                    _mxrv = _rv.abs().max()
                    _rscl = 100.0 if pd.notna(_mxrv) and _mxrv <= 1.0 else 1.0
                    _gbr = _gpt_rg.assign(_rv=_rv).groupby("Market_Label")["_rv"].mean()
                    if len(_gbr) > 0:
                        _wrt = _gbr.idxmin()
                        _exec_lines.append(
                            f"<strong>Portfolio return by trend (filtered GPT runs):</strong> lowest mean bucket is "
                            f"<strong>{_wrt}</strong> (≈ {_gbr.min() * _rscl:.2f}% per period at this scale)."
                        )
            st.markdown(
                "<div style='margin:12px 0 16px 0;padding:14px 18px;border-radius:10px;border:1px solid #2E4A6A;"
                "background:linear-gradient(145deg,#0F1A28 0%,#152536 100%);font-size:13px;line-height:1.65;color:#C8D4E0;'>"
                + "<br><br>".join(_exec_lines)
                + "</div>",
                unsafe_allow_html=True,
            )

        soft_hr()
        section_header("GPT vs benchmark portfolios & markets — primary comparison")
        st.caption(
            "Bars show **mean** period Sharpe; hover lists **median** and **n** (runs for GPT, strategy cells for benchmarks). "
            "**Excess vs index** uses the same buckets as the X-axis control below. "
            "Uses the **Filters** expander at the top of this tab. "
            "Regime **Return %** in the executive strip comes from your runs when available; index cells use **strategy_cells**."
        )

        if len(_bm_rg) > 0 and "sharpe" in _bm_rg.columns and "strategy_key" in _bm_rg.columns:
            _sk_avail = sorted(
                set(_bm_rg["strategy_key"].dropna().astype(str).unique()) & set(_bench_meta.keys())
            )
            if _sk_avail:
                _bc1, _bc2 = st.columns([1.2, 1])
                with _bc1:
                    _sel_bench_rg = st.multiselect(
                        "Benchmark portfolios to plot",
                        options=_sk_avail,
                        default=[s for s in ("index", "sixty_forty", "equal_weight") if s in _sk_avail],
                        format_func=lambda k: _bench_meta[k][0],
                        key="rg_vs_bench_pick",
                    )
                with _bc2:
                    _rg_x_opts = ("Trend regime", "Volatility regime", "Rate regime")
                    if st.session_state.get("rg_vs_x_dim") not in _rg_x_opts:
                        st.session_state.pop("rg_vs_x_dim", None)
                    _rg_x_dim = st.selectbox(
                        "X-axis grouping (regime)",
                        list(_rg_x_opts),
                        index=0,
                        key="rg_vs_x_dim",
                        help="Compare GPT vs benchmarks within each regime. Markets and periods follow the tab **Filters** expander.",
                    )

                _reg_dim_map = {
                    "Trend regime": ("Market_Label", _trend_order),
                    "Volatility regime": ("Vol_Label", _vol_order),
                    "Rate regime": ("Rate_Label", _rate_order),
                }
                _rcol, _pref_order = _reg_dim_map[_rg_x_dim]

                def _rg_cat_order(series, preferred):
                    seen = {str(x) for x in series.dropna().unique()}
                    if preferred:
                        out = list(preferred)
                        for x in sorted(seen - set(out), key=str):
                            out.append(x)
                        return out
                    return sorted(seen, key=str)

                _cats = _rg_cat_order(
                    pd.concat([_bm_rg[_rcol], _gpt_rg[_rcol]], ignore_index=True),
                    _pref_order,
                )
                _x_labels = [str(c) for c in _cats]

                if _sel_bench_rg and _cats:
                    fig_vs = go.Figure()
                    _show_gpt_r = _rg_prompt_mode != "Advanced only"
                    _show_gpt_a = _rg_prompt_mode != "Retail only"

                    def _add_gpt_regime_bars(_sub, _name, _color, _lgrp):
                        if len(_sub) == 0 or "sharpe_ratio" not in _sub.columns:
                            return
                        _st = _sub.groupby(_rcol)["sharpe_ratio"].agg(["mean", "median", "count"])
                        _yv, _cd, _bt = [], [], []
                        for _ci in _cats:
                            if _ci in _st.index:
                                _rr = _st.loc[_ci]
                                _mu = float(_rr["mean"])
                                _md = _rr["median"]
                                _nc = int(_rr["count"])
                                _yv.append(_mu)
                                if pd.notna(_md):
                                    _cd.append(f"Mean: {_mu:.3f}<br>Median: {float(_md):.3f}<br>Run periods: {_nc}")
                                else:
                                    _cd.append(f"Mean: {_mu:.3f}<br>Run periods: {_nc}")
                                _bt.append(f"{_mu:.2f}<br>(n={_nc})")
                            else:
                                _yv.append(np.nan)
                                _cd.append("No observations in filter")
                                _bt.append("")
                        fig_vs.add_trace(go.Bar(
                            name=_name,
                            x=_x_labels, y=_yv,
                            marker_color=_color,
                            marker_line=dict(color="#E8EEF7", width=0.5),
                            legendgroup=_lgrp,
                            text=_bt,
                            textposition="outside",
                            textfont=dict(size=10, color="#E8EEF7"),
                            hovertemplate="<b>%{x}</b><br>" + _name + "<br>%{customdata}<extra></extra>",
                            customdata=_cd,
                        ))

                    if _show_gpt_r:
                        _add_gpt_regime_bars(
                            _gpt_rg[_gpt_rg["prompt_type"].astype(str).str.lower() == "retail"],
                            "GPT Retail", ACCENT, "gpt",
                        )
                    if _show_gpt_a:
                        _add_gpt_regime_bars(
                            _gpt_rg[_gpt_rg["prompt_type"].astype(str).str.lower() == "advanced"],
                            "GPT Advanced", "#FB923C", "gpt",
                        )

                    for _sk in _sel_bench_rg:
                        _bs = _bm_rg[_bm_rg["strategy_key"].astype(str) == _sk]
                        if len(_bs) == 0:
                            continue
                        _bst = _bs.groupby(_rcol)["sharpe"].agg(["mean", "count"])
                        _yv, _cd, _bt = [], [], []
                        for _ci in _cats:
                            if _ci in _bst.index:
                                _rr = _bst.loc[_ci]
                                _mu = float(_rr["mean"])
                                _nc = int(_rr["count"])
                                _yv.append(_mu)
                                _cd.append(f"Mean: {_mu:.3f}<br>Strategy cells (mkt×period): {_nc}")
                                _bt.append(f"{_mu:.2f}<br>(n={_nc})")
                            else:
                                _yv.append(np.nan)
                                _cd.append("No cells in filter")
                                _bt.append("")
                        _nm, _clr = _bench_meta[_sk]
                        fig_vs.add_trace(go.Bar(
                            name=_nm,
                            x=_x_labels, y=_yv,
                            marker_color=_clr,
                            marker_line=dict(color="#E8EEF7", width=0.5),
                            legendgroup="bench",
                            text=_bt,
                            textposition="outside",
                            textfont=dict(size=10, color="#E8EEF7"),
                            hovertemplate=f"<b>%{{x}}</b><br>{_nm}<br>%{{customdata}}<extra></extra>",
                            customdata=_cd,
                        ))

                    fig_vs.update_layout(
                        **{k: v for k, v in PLOT_LAYOUT.items() if k != "legend"},
                        title=f"Mean Sharpe — GPT vs benchmarks ({_rg_x_dim})",
                        barmode="group",
                        bargap=0.2,
                        bargroupgap=0.06,
                        height=480,
                        yaxis_title="Mean period Sharpe",
                        xaxis_title=_rg_x_dim.replace(" regime", ""),
                        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="center", x=0.5),
                    )
                    _apply_grid(fig_vs)
                    st.plotly_chart(fig_vs, width="stretch", key="rg_vs_bench_bar")

                    if "index" in set(_bm_rg["strategy_key"].astype(str)):
                        _idx_ex = _bm_rg[_bm_rg["strategy_key"].astype(str) == "index"]
                        _x_exc, _y_exc = [], []
                        for _ci, _xl in zip(_cats, _x_labels):
                            _gmu = _gpt_rg[_gpt_rg[_rcol].astype(str) == str(_ci)]["sharpe_ratio"].mean()
                            _imu = _idx_ex[_idx_ex[_rcol].astype(str) == str(_ci)]["sharpe"].mean()
                            if pd.notna(_gmu) and pd.notna(_imu):
                                _x_exc.append(_xl)
                                _y_exc.append(float(_gmu - _imu))
                        if _x_exc:
                            fig_ex = go.Figure(go.Bar(
                                x=_x_exc,
                                y=_y_exc,
                                marker_color=["#34D399" if _y >= 0 else "#F87171" for _y in _y_exc],
                                marker_line=dict(color="#E8EEF7", width=0.5),
                                text=[f"{_y:+.2f}" for _y in _y_exc],
                                textposition="outside",
                                textfont=dict(size=11, color="#E8EEF7"),
                                hovertemplate="<b>%{x}</b><br>μ GPT − μ index: %{y:.3f}<extra></extra>",
                            ))
                            fig_ex.add_hline(y=0, line_dash="solid", line_color="#5E7082", line_width=1)
                            fig_ex.update_layout(
                                **{k: v for k, v in PLOT_LAYOUT.items() if k != "legend"},
                                title=(
                                    "Excess Sharpe vs market index — "
                                    f"{_rg_x_dim.replace(' regime', '')} (pooled GPT mean − index mean)"
                                ),
                                yaxis_title="Sharpe difference (GPT − index)",
                                height=360,
                                showlegend=False,
                            )
                            _apply_grid(fig_ex)
                            st.plotly_chart(fig_ex, width="stretch", key="rg_excess_idx_bar")

                    with st.expander("Regime detail — n, means, medians, returns, excess vs index", expanded=False):
                        _idx_d = (
                            _bm_rg[_bm_rg["strategy_key"].astype(str) == "index"]
                            if "index" in set(_bm_rg["strategy_key"].astype(str))
                            else pd.DataFrame()
                        )
                        _detail_rows = []
                        for _ci, _xl in zip(_cats, _x_labels):
                            _cg = _gpt_rg[_gpt_rg[_rcol].astype(str) == str(_ci)]
                            _dr = {"Bucket": _xl, "n GPT": int(len(_cg))}
                            if "sharpe_ratio" in _cg.columns and len(_cg) > 0:
                                _sr = pd.to_numeric(_cg["sharpe_ratio"], errors="coerce").dropna()
                                _dr["GPT μ Sharpe"] = float(_sr.mean()) if len(_sr) else np.nan
                                _dr["GPT med Sharpe"] = float(_sr.median()) if len(_sr) else np.nan
                            else:
                                _dr["GPT μ Sharpe"] = np.nan
                                _dr["GPT med Sharpe"] = np.nan
                            if _ret_rg and _ret_rg in _cg.columns and len(_cg) > 0:
                                _rv = pd.to_numeric(_cg[_ret_rg], errors="coerce").dropna()
                                if len(_rv) > 0:
                                    _mxv = _rv.abs().max()
                                    _scl = 100.0 if pd.notna(_mxv) and _mxv <= 1.0 else 1.0
                                    _dr["GPT μ return %"] = float(_rv.mean() * _scl)
                                else:
                                    _dr["GPT μ return %"] = np.nan
                            else:
                                _dr["GPT μ return %"] = np.nan
                            if "Return_%" in _cg.columns and len(_cg) > 0:
                                _mkt_r = pd.to_numeric(_cg["Return_%"], errors="coerce").dropna()
                                _dr["Regime sheet mkt Return % μ"] = float(_mkt_r.mean()) if len(_mkt_r) else np.nan
                            else:
                                _dr["Regime sheet mkt Return % μ"] = np.nan
                            if len(_idx_d) > 0:
                                _idc = _idx_d[_idx_d[_rcol].astype(str) == str(_ci)]
                                _dr["n index cells"] = int(len(_idc))
                                _dr["Index μ Sharpe"] = float(_idc["sharpe"].mean()) if len(_idc) else np.nan
                                if pd.notna(_dr["GPT μ Sharpe"]) and pd.notna(_dr["Index μ Sharpe"]):
                                    _dr["Excess (GPT−idx)"] = _dr["GPT μ Sharpe"] - _dr["Index μ Sharpe"]
                                else:
                                    _dr["Excess (GPT−idx)"] = np.nan
                            else:
                                _dr["n index cells"] = 0
                                _dr["Index μ Sharpe"] = np.nan
                                _dr["Excess (GPT−idx)"] = np.nan
                            _detail_rows.append(_dr)
                        st.dataframe(pd.DataFrame(_detail_rows), width="stretch", hide_index=True)
            else:
                st.info("No benchmark Sharpe rows matched regime labels (check period codes vs regime file).")
        elif len(strat_cells) == 0 or "sharpe" not in strat_cells.columns:
            st.info("No benchmark strategy cells (Sharpe) in this package — cannot compare to index/60/40/etc.")
        else:
            st.info("Regime reference missing — load regime data to align benchmarks with Bull/Bear and vol regimes.")
        soft_hr()
        section_header("Head-to-head — prompts vs regimes & markets")
        st.caption(
            "Retail vs Advanced only — compare to benchmarks in the **GPT vs benchmark portfolios** section above. "
            "Same **Filters** as the rest of this tab."
        )
        if "sharpe_ratio" in _gpt_rg.columns and "prompt_type" in _gpt_rg.columns:
            _gpt_low = _gpt_rg.copy()
            _gpt_low["prompt_type"] = _gpt_low["prompt_type"].astype(str).str.lower().map(
                {"retail": "Retail", "advanced": "Advanced"}
            ).fillna(_gpt_low["prompt_type"])

            _h1, _h2 = st.columns(2)
            with _h1:
                _agg_trend = (
                    _gpt_low.groupby(["Market_Label", "prompt_type"], dropna=False)["sharpe_ratio"]
                    .agg(["mean", "count"]).reset_index()
                )
                _agg_trend = _agg_trend[_agg_trend["count"] > 0]
                _xl_t = list(_trend_order) if _trend_order else list(FULL_TREND_REGIME_ORDER)
                fig_ht = go.Figure()
                for _pt, _pc, _pn in [("Retail", ACCENT, "Retail"), ("Advanced", "#FB923C", "Advanced")]:
                    _sub_a = _agg_trend[_agg_trend["prompt_type"] == _pt]
                    if len(_sub_a) == 0:
                        continue
                    _sub_a = _sub_a.set_index("Market_Label").reindex(_xl_t).reset_index()
                    fig_ht.add_trace(go.Bar(
                        name=_pn,
                        x=_sub_a["Market_Label"].astype(str),
                        y=_sub_a["mean"],
                        marker_color=_pc,
                        marker_line=dict(color="#E8EEF7", width=0.5),
                        text=[f"{v:.2f}" if pd.notna(v) else "" for v in _sub_a["mean"]],
                        textposition="outside",
                        textfont=dict(size=11, color="#E8EEF7"),
                        hovertemplate="<b>%{x}</b> · %{fullData.name}<br>Mean Sharpe: %{y:.3f}<extra></extra>",
                    ))
                fig_ht.update_layout(
                    **{k: v for k, v in PLOT_LAYOUT.items() if k != "legend"},
                    title="Mean Sharpe by trend regime — grouped by prompt",
                    barmode="group",
                    bargap=0.18,
                    bargroupgap=0.08,
                    legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
                    height=380,
                    yaxis_title="Mean Sharpe",
                )
                _apply_grid(fig_ht)
                st.plotly_chart(fig_ht, width="stretch", key="rg_head_trend")

            with _h2:
                _agg_mkt = (
                    _gpt_low.groupby(["market", "prompt_type"], dropna=False)["sharpe_ratio"]
                    .agg(["mean", "count"]).reset_index()
                )
                _agg_mkt = _agg_mkt[_agg_mkt["count"] > 0]
                _xm = sorted(_agg_mkt["market"].dropna().unique())
                _xlab = [MARKET_LABELS.get(m, m) for m in _xm]
                fig_hm = go.Figure()
                for _pt, _pc, _pn in [("Retail", ACCENT, "Retail"), ("Advanced", "#FB923C", "Advanced")]:
                    _sub_m = _agg_mkt[_agg_mkt["prompt_type"] == _pt]
                    if len(_sub_m) == 0:
                        continue
                    _ys = []
                    for m in _xm:
                        row = _sub_m[_sub_m["market"] == m]
                        _ys.append(float(row["mean"].iloc[0]) if len(row) else np.nan)
                    fig_hm.add_trace(go.Bar(
                        name=_pn,
                        x=_xlab,
                        y=_ys,
                        marker_color=_pc,
                        marker_line=dict(color="#E8EEF7", width=0.5),
                        text=[f"{v:.2f}" if pd.notna(v) else "" for v in _ys],
                        textposition="outside",
                        textfont=dict(size=11, color="#E8EEF7"),
                        hovertemplate="<b>%{x}</b> · %{fullData.name}<br>Mean Sharpe: %{y:.3f}<extra></extra>",
                    ))
                fig_hm.update_layout(
                    **{k: v for k, v in PLOT_LAYOUT.items() if k != "legend"},
                    title="Mean Sharpe by market — grouped by prompt",
                    barmode="group",
                    bargap=0.2,
                    legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
                    height=380,
                    yaxis_title="Mean Sharpe",
                )
                _apply_grid(fig_hm)
                st.plotly_chart(fig_hm, width="stretch", key="rg_head_mkt")

            if _rg_compare_both:
                _agg_cell = (
                    _gpt_low.groupby(["market", "Market_Label", "prompt_type"], dropna=False)["sharpe_ratio"]
                    .mean().reset_index()
                )
                _agg_cell = _agg_cell.rename(columns={"sharpe_ratio": "mean_sr"})
                _mk_list = sorted(_agg_cell["market"].dropna().unique())
                if len(_mk_list) > 0:
                    fig_sp = make_subplots(
                        rows=1, cols=len(_mk_list), subplot_titles=[MARKET_LABELS.get(m, m) for m in _mk_list],
                        horizontal_spacing=0.06,
                    )
                    for _ci, _m in enumerate(_mk_list):
                        _chunk = _agg_cell[_agg_cell["market"] == _m]
                        _xord = list(_trend_order) if _trend_order else list(FULL_TREND_REGIME_ORDER)
                        for _pt, _pc, _pn in [("Retail", ACCENT, "Retail"), ("Advanced", "#FB923C", "Advanced")]:
                            _c2 = _chunk[_chunk["prompt_type"] == _pt].set_index("Market_Label").reindex(_xord).reset_index()
                            fig_sp.add_trace(
                                go.Bar(
                                    name=_pn if _ci == 0 else None,
                                    x=_c2["Market_Label"].astype(str),
                                    y=_c2["mean_sr"],
                                    marker_color=_pc,
                                    legendgroup=_pn,
                                    showlegend=(_ci == 0),
                                    hovertemplate="%{x}<br>%{fullData.name}: %{y:.3f}<extra></extra>",
                                ),
                                row=1, col=_ci + 1,
                            )
                    fig_sp.update_layout(
                        **{k: v for k, v in PLOT_LAYOUT.items() if k not in ("title", "legend")},
                        title_text="Faceted: trend regime × prompt (per market)",
                        height=400,
                        barmode="group",
                        legend=dict(orientation="h", yanchor="bottom", y=1.06, x=0.5, xanchor="center"),
                    )
                    fig_sp.update_yaxes(title_text="Mean Sharpe")
                    st.plotly_chart(fig_sp, width="stretch", key="rg_facet_mkt_trend")

        soft_hr()
        section_header("Retail vs Advanced — Regime Comparison")

        def _regime_bar_block(_sub, _lab, _key):
            if len(_sub) == 0 or "sharpe_ratio" not in _sub.columns:
                st.caption(f"No data for {_lab}.")
                return
            _gb = _sub.groupby("Market_Label", dropna=False)["sharpe_ratio"].agg(["mean", "count", "std"])
            _y_order = list(FULL_TREND_REGIME_ORDER)
            for x in sorted(_gb.index.astype(str).unique(), key=str):
                if x not in _y_order:
                    _y_order.append(x)
            _agg = _gb.reindex(_y_order).reset_index()
            _agg.columns = ["Market_Label", "mean", "count", "std"]
            _cnt = pd.to_numeric(_agg["count"], errors="coerce").fillna(0)
            _bar_colors = [_trend_colors.get(str(r["Market_Label"]), "#5E7082") for _, r in _agg.iterrows()]
            _txt = [
                f"{m:.2f} (n={int(c)})" if pd.notna(m) and c > 0 else ""
                for m, c in zip(_agg["mean"], _cnt)
            ]
            fig_b = go.Figure(go.Bar(
                y=_agg["Market_Label"].astype(str),
                x=_agg["mean"],
                orientation="h",
                marker_color=_bar_colors,
                marker_line=dict(color="#E8EEF7", width=1),
                text=_txt,
                textposition="outside",
                textfont=dict(color="#E8EEF7", size=12),
                hovertemplate="<b>%{y}</b><br>Mean Sharpe: %{x:.3f}<extra></extra>",
            ))
            fig_b.add_vline(x=0, line_color="#5E7082", line_width=1)
            fig_b.update_layout(**PLOT_LAYOUT, title=f"{_lab} — mean Sharpe by trend regime",
                                xaxis_title="Mean Sharpe", height=280, showlegend=False)
            fig_b.update_yaxes(categoryorder="array", categoryarray=_y_order)
            _apply_grid(fig_b)
            st.plotly_chart(fig_b, width="stretch", key=_key)

        _rx1, _rx2 = st.columns(2)
        with _rx1:
            _regime_bar_block(
                _gpt_rg[_gpt_rg["prompt_type"].astype(str).str.lower() == "retail"],
                "Retail prompt", "regime_bar_retail",
            )
        with _rx2:
            _regime_bar_block(
                _gpt_rg[_gpt_rg["prompt_type"].astype(str).str.lower() == "advanced"],
                "Advanced prompt", "regime_bar_advanced",
            )

        soft_hr()
        section_header("Summary Table — All regime dimensions")
        st.caption(
            "Each row is **one portfolio run × period**. **Trend / Vol / Rates** come from the regime file for that "
            "market–period (the same for every run in that cell). "
            "Missing **Sharpe** or **Return %** means those values were not present in **Portfolio runs** for that row "
            "(or could not be read). Multiple runs in the same period show as separate rows with the same regime labels."
        )

        _run_col = next(
            (c for c in ("trajectory_id", "run_id", "portfolio_key", "experiment_id") if c in _gpt_rg.columns),
            None,
        )
        _sum_rows = []
        for _, row in _gpt_rg.iterrows():
            _entry = {
                "Market": MARKET_LABELS.get(str(row.get("market")), row.get("market")),
                "Period": row.get("period"),
                "Prompt": row.get("prompt_type"),
                "Trend": row.get("Market_Label"),
                "Vol": row.get("Vol_Label"),
                "Rates": row.get("Rate_Label"),
                "Sharpe": pd.to_numeric(row.get("sharpe_ratio"), errors="coerce"),
                "Return": pd.to_numeric(row.get(_ret_rg), errors="coerce") if _ret_rg else np.nan,
            }
            if _run_col:
                _entry["Run / trajectory"] = row.get(_run_col)
            _sum_rows.append(_entry)
        _sum_df = pd.DataFrame(_sum_rows)
        if _ret_rg and "Return" in _sum_df.columns:
            _sum_df["Return"] = pd.to_numeric(_sum_df["Return"], errors="coerce")
            _mxr = _sum_df["Return"].abs().max()
            if pd.notna(_mxr) and _mxr <= 1.0:
                _sum_df["Return %"] = (_sum_df["Return"] * 100).round(2)
            else:
                _sum_df["Return %"] = _sum_df["Return"].round(2)
            _sum_df = _sum_df.drop(columns=["Return"], errors="ignore")
        _col_order = ["Market", "Period"]
        if "Run / trajectory" in _sum_df.columns:
            _col_order.append("Run / trajectory")
        _col_order += ["Prompt", "Trend", "Vol", "Rates", "Sharpe"]
        if "Return %" in _sum_df.columns:
            _col_order.append("Return %")
        _show_sum = _sum_df[[c for c in _col_order if c in _sum_df.columns]]
        if "Sharpe" in _show_sum.columns and len(_show_sum) > 0:
            try:
                st.dataframe(
                    _show_sum.style.background_gradient(subset=["Sharpe"], cmap="RdYlGn", low=0.2, high=0.8),
                    width="stretch",
                    height=420,
                    hide_index=True,
                )
            except Exception:
                st.dataframe(_show_sum, width="stretch", height=420, hide_index=True)
        else:
            st.dataframe(_show_sum, width="stretch", hide_index=True)

        st.caption(
            "Sharpe column uses a green–red gradient. The tab **Filters** expander narrows this table like the charts; "
            "the sidebar market filter only sets default markets inside that expander."
        )


# ══════════════════════════════════════════
# TESTS & RISK
# ══════════════════════════════════════════
with tab_research:
    st.caption("Formal tests, portfolio behavior metrics, and drawdown analysis.")
    _rt_st, _rt_bh, _rt_dd = st.tabs(["Statistical tests", "Behavior", "Drawdowns"])
    with _rt_st:
        section_header("Statistical Significance")

        if len(stats) > 0:
            # Significance summary KPIs
            n_tests = len(stats)
            n_sig = stats["significant_5pct"].sum() if "significant_5pct" in stats.columns else 0
            cols = st.columns(3)
            with cols[0]:
                kpi_card("Total tests", str(n_tests), ACCENT)
            with cols[1]:
                kpi_card("Significant (5%)", str(int(n_sig)), GREEN, f"{n_sig/n_tests*100:.0f}% of tests")
            with cols[2]:
                kpi_card("Not significant", str(int(n_tests - n_sig)), RED)

            # Full table
            display_stats = stats.copy()
            display_stats["p_value_fmt"] = display_stats["p_value"].apply(
                lambda p: f"{p:.2e}" if p < 0.001 else f"{p:.4f}"
            )
            display_stats["sig_marker"] = display_stats["significant_5pct"].apply(
                lambda v: "Yes ***" if v else "No"
            )
            display_stats["mean_diff_fmt"] = display_stats["mean_diff"].apply(lambda v: f"{v:+.4f}")
            display_stats["t_stat_fmt"] = display_stats["t_stat"].apply(lambda v: f"{v:.2f}")

            show_cols = ["strategy", "metric", "benchmark", "n_obs", "mean_diff_fmt", "t_stat_fmt", "p_value_fmt", "sig_marker"]
            available = [c for c in show_cols if c in display_stats.columns]
            tbl = display_stats[available].copy()
            tbl.columns = ["Strategy", "Metric", "Benchmark", "n", "Mean Diff", "t-stat", "p-value", "Sig (5%)"][:len(available)]
            st.dataframe(tbl, width="stretch", hide_index=True)

            # p-value forest plot
            section_header("P-Values (Log Scale)")
            stats_sorted = stats.sort_values("p_value", ascending=False).copy()
            stats_sorted["label"] = stats_sorted.apply(
                lambda r: f"{r['strategy'][:12]} | {r['metric'][:8]} vs {r['benchmark'][:8]}", axis=1
            )
            stats_sorted["neg_log_p"] = -np.log10(stats_sorted["p_value"].clip(lower=1e-8))
            stats_sorted["bar_color"] = stats_sorted["significant_5pct"].apply(lambda v: GREEN if v else RED)

            fig = go.Figure(go.Bar(
                y=stats_sorted["label"],
                x=stats_sorted["neg_log_p"],
                orientation="h",
                marker_color=stats_sorted["bar_color"],
                text=[f"p={p:.4f}" if p >= 0.001 else f"p={p:.1e}" for p in stats_sorted["p_value"]],
                textposition="auto",
            ))
            fig.add_vline(x=-np.log10(0.05), line_dash="dash", line_color=AMBER, line_width=2,
                          annotation_text="p = 0.05", annotation_position="top right",
                          annotation_font=dict(color=AMBER, size=11))
            fig.update_layout(**PLOT_LAYOUT, title="Statistical significance (-log10 p)", xaxis_title="-log10(p)",
                              height=max(400, len(stats_sorted) * 28))
            st.plotly_chart(fig, width="stretch")

            # Key findings
            soft_hr()
            section_header("Key Significance Findings")
            gpt_sig = stats[(stats["significant_5pct"] == True) & (stats["strategy"].str.contains("GPT", case=False))]
            gpt_nonsig = stats[(stats["significant_5pct"] == False) & (stats["strategy"].str.contains("GPT", case=False))]

            for _, row in gpt_sig.iterrows():
                insight_card("pos", f"{row['strategy']} significantly beats {row['benchmark']}",
                             f"Metric: {row['metric']} | Mean diff: {row['mean_diff']:+.4f} | p = {row['p_value']:.4f} | n = {row['n_obs']}")

            for _, row in gpt_nonsig.iterrows():
                insight_card("warn", f"{row['strategy']} vs {row['benchmark']}: not significant",
                             f"Metric: {row['metric']} | Mean diff: {row['mean_diff']:+.4f} | p = {row['p_value']:.3f} | n = {row['n_obs']}")

        else:
            st.info("No statistical test data found.")


    with _rt_bh:
        section_header("Portfolio Behavior Analysis")

        if len(behavior) > 0:
            cols = st.columns(4)
            for i, (_, row) in enumerate(behavior.iterrows()):
                if i >= 2:
                    break
                label = "Retail" if row.get("prompt_type") == "retail" else "Advanced"
                with cols[i * 2]:
                    kpi_card(
                        f"{label}: Concentration",
                        f"HHI {row.get('mean_hhi', 0):.3f}",
                        ACCENT,
                        f"~{row.get('mean_effective_n_holdings', 0):.1f} effective holdings",
                    )
                with cols[i * 2 + 1]:
                    kpi_card(
                        f"{label}: Turnover",
                        fmtp(row.get("mean_turnover", 0) * 100),
                        AMBER,
                        f"Median {row.get('median_turnover', 0) * 100:.1f}%",
                    )

        # Forecast accuracy
        if len(behavior) > 0:
            soft_hr()
            section_header("Forecast Accuracy")
            c1, c2 = st.columns(2)
            with c1:
                labels = [row.get("prompt_type", "").title() for _, row in behavior.iterrows()]
                expected = [row.get("mean_expected_portfolio_return_6m", 0) * 100 for _, row in behavior.iterrows()]
                realized = [row.get("mean_realized_net_return", 0) * 100 for _, row in behavior.iterrows()]
                abs_err = [row.get("mean_forecast_abs_error", 0) * 100 for _, row in behavior.iterrows()]

                fig = go.Figure()
                fig.add_trace(go.Bar(x=labels, y=expected, name="Expected (6m)", marker_color=ACCENT))
                fig.add_trace(go.Bar(x=labels, y=realized, name="Realized", marker_color="#FB923C"))
                fig.add_trace(go.Bar(x=labels, y=abs_err, name="Abs. error", marker_color="#5E7082"))
                fig.update_layout(**PLOT_LAYOUT, title="Forecast vs realized returns (%)", barmode="group",
                                  yaxis_title="Percentage")
                st.plotly_chart(fig, width="stretch")

            with c2:
                bias = [row.get("mean_forecast_bias", 0) * 100 for _, row in behavior.iterrows()]
                fig = go.Figure(go.Bar(
                    x=labels, y=bias,
                    marker_color=[GREEN if b < 0 else RED for b in bias],
                    text=[f"{b:+.2f}%" for b in bias],
                    textposition="auto",
                ))
                fig.add_hline(y=0, line_dash="dot", line_color="#5E7082")
                fig.update_layout(**PLOT_LAYOUT, title="Forecast bias (negative = underestimates)",
                                  yaxis_title="Bias %")
                st.plotly_chart(fig, width="stretch")

        # Post-loss analysis (Portfolio runs: post_loss_rebalance flag when present, else inferred)
        soft_hr()
        section_header("Post-Loss Analysis")
        _pla = compute_post_loss_analysis_from_runs(runs)
        if _pla is None:
            st.info(
                "Need **Portfolio runs** with a return column (`net_return`, `period_return_net`, or `period_return`), "
                "a run identifier (`trajectory_id`, `portfolio_key`, `run_id`, or `portfolio_id`), and **`period`**."
            )
        else:
            _src = _pla.get("source", "")
            if _pla.get("flag_column"):
                st.caption(
                    f"**After-loss periods** are rows where **`{_pla['flag_column']}`** is true on **Portfolio runs** "
                    "(evaluation package — e.g. `evaluation_package_all_2025_*.xlsx`). "
                    "**Recovery rate** = share of those rows with **positive** period return. "
                    + ("**Retail** and **advanced** only." if _pla.get("has_prompt_scope") else "All runs included.")
                    + (f"\n\n*{_src}*")
                )
            else:
                st.caption(
                    "Per trajectory, rows are sorted by **`period`**. A period **follows a loss** if the **previous** period "
                    "had negative return. **Recovery rate** = share of those periods with **positive** return. "
                    + ("**Retail** and **advanced** rows only." if _pla.get("has_prompt_scope") else "All runs included.")
                    + (f"\n\n*{_src}*")
                )
            if _pla["n_loss_periods"] == 0 and _pla.get("n_after_loss", 0) == 0:
                st.info(
                    "No **after-loss** periods in the scoped runs (no `post_loss_rebalance` flags and no inferred "
                    "post-loss periods) — nothing to summarize."
                )
            else:
                _pc1, _pc2, _pc3, _pc4 = st.columns(4)
                with _pc1:
                    kpi_card("Loss periods", str(_pla["n_loss_periods"]), RED, "negative return")
                with _pc2:
                    kpi_card("After-loss periods", str(_pla["n_after_loss"]), AMBER, "follow a loss")
                with _pc3:
                    _rec = _pla.get("recovery_pct", np.nan)
                    kpi_card(
                        "Recovery rate",
                        fmtp(_rec, 1) if pd.notna(_rec) else "—",
                        GREEN if pd.notna(_rec) and _rec >= 50 else AMBER,
                        "positive return in after-loss period" if _pla.get("flag_column") else "positive return next period",
                    )
                with _pc4:
                    _amr = _pla.get("after_loss_mean_return", np.nan)
                    _amr_disp = (
                        f"{_amr * 100:.2f}%" if pd.notna(_amr) and abs(_amr) < 5 else (f"{_amr:.2f}%" if pd.notna(_amr) else "—")
                    )
                    kpi_card("Mean return (after loss)", _amr_disp, ACCENT, "same periods as recovery")

                if pd.notna(_pla.get("hhi_diff")):
                    soft_hr()
                    st.markdown("##### Concentration after losses (HHI)")
                    _hc1, _hc2, _hc3 = st.columns(3)
                    with _hc1:
                        kpi_card("HHI after loss", fmt(_pla["hhi_after"], 4), RED if _pla["hhi_diff"] > 0 else GREEN)
                    with _hc2:
                        kpi_card("HHI other periods", fmt(_pla["hhi_other"], 4), "#5E7082")
                    with _hc3:
                        kpi_card("Difference", fmt(_pla["hhi_diff"], 4), AMBER if abs(_pla["hhi_diff"]) > 0.02 else GREEN, "after − other")

                if _pla.get("by_prompt"):
                    soft_hr()
                    st.markdown("##### By prompt type")
                    _bpd = pd.DataFrame(_pla["by_prompt"])
                    _disp_bp = _bpd.copy()
                    if "Recovery %" in _disp_bp.columns:
                        _disp_bp["Recovery %"] = _disp_bp["Recovery %"].map(lambda x: f"{x:.1f}%" if pd.notna(x) else "—")
                    if "Mean return" in _disp_bp.columns:
                        def _pl_fmt_ret(v):
                            if pd.isna(v):
                                return "—"
                            v = float(v)
                            return f"{v * 100:.2f}%" if abs(v) < 5 else f"{v:.2f}%"
                        _disp_bp["Mean return"] = _disp_bp["Mean return"].map(_pl_fmt_ret)
                    st.dataframe(_disp_bp, width="stretch", hide_index=True)

                _plq = qualitative_post_loss_reasoning(runs, _pla)
                if _plq is not None:
                    soft_hr()
                    st.markdown("##### Qualitative — portfolio reasoning (post-loss periods)")
                    st.caption(
                        "Uses the same **after-loss** rows as above. Reasoning is taken from the **first non-empty** column "
                        "matching Run Explorer (e.g. `reasoning_summary`, `rationale`). **Themes** are simple keyword hits per row "
                        "(one row can match several themes) — a structured skim, not NLP."
                    )
                    if not _plq.get("reasoning_cols"):
                        st.info(
                            "No reasoning-style columns detected on **Portfolio runs**. "
                            "Exports often use names like `reasoning_summary`, `reasoning`, or `rationale`."
                        )
                    else:
                        _q1, _q2, _q3 = st.columns(3)
                        with _q1:
                            kpi_card(
                                "After-loss rows",
                                str(_plq["n_after_loss_rows"]),
                                ACCENT,
                                "matched Portfolio runs",
                            )
                        with _q2:
                            kpi_card(
                                "With reasoning text",
                                str(_plq["n_with_reasoning"]),
                                GREEN if _plq["n_with_reasoning"] > 0 else AMBER,
                                f"cols: {', '.join(_plq['reasoning_cols'][:3])}{'…' if len(_plq['reasoning_cols']) > 3 else ''}",
                            )
                        with _q3:
                            _mc = _plq.get("mean_chars_when_present", np.nan)
                            kpi_card(
                                "Avg length (when present)",
                                f"{int(_mc)}" if pd.notna(_mc) else "—",
                                "#5E7082",
                                "characters",
                            )

                        _tc = {k: v for k, v in _plq.get("theme_counts", {}).items() if v > 0}
                        if _tc:
                            _labels_t = list(_tc.keys())
                            _vals_t = list(_tc.values())
                            fig_t = go.Figure(go.Bar(
                                x=_vals_t,
                                y=_labels_t,
                                orientation="h",
                                marker_color=CYAN,
                                text=[str(v) for v in _vals_t],
                                textposition="outside",
                            ))
                            fig_t.update_layout(
                                **PLOT_LAYOUT,
                                title="Theme keywords in post-loss reasoning (row hit counts)",
                                xaxis_title="Rows with ≥1 match",
                                height=max(260, 36 * len(_labels_t)),
                            )
                            st.plotly_chart(fig_t, width="stretch", key="pl_qual_themes")

                        _ex = _plq.get("excerpts") or []
                        if _ex:
                            with st.expander("Truncated excerpts (post-loss periods)", expanded=False):
                                _show = [{k: v for k, v in e.items() if k != "_full"} for e in _ex]
                                st.dataframe(pd.DataFrame(_show), width="stretch", hide_index=True)
                            with st.expander("Read full reasoning text", expanded=False):
                                _opts = [
                                    f"{e.get('Trajectory', '')} · {e.get('Market', '')} · {e.get('Period', '')} · {e.get('Prompt', '')}"
                                    for e in _ex
                                ]
                                _pick = st.selectbox("Select row", range(len(_ex)), format_func=lambda i: _opts[i], key="pl_qual_pick")
                                st.caption(f"Column: `{_ex[_pick].get('Column', '')}` · {_ex[_pick].get('Chars', 0)} chars")
                                st.text(_ex[_pick].get("_full", ""))

                _plt = _pla.get("after_loss_table")
                if _plt is not None and len(_plt) > 0:
                    with st.expander("After-loss periods (row detail)", expanded=False):
                        _det = _plt.copy()
                        _rcn = _pla["ret_col"]
                        if _rcn in _det.columns:
                            def _pl_fmt_cell(v):
                                if pd.isna(v):
                                    return "—"
                                v = float(v)
                                return f"{v * 100:.2f}%" if abs(v) < 5 else f"{v:.2f}%"
                            _det[_rcn] = pd.to_numeric(_det[_rcn], errors="coerce").map(_pl_fmt_cell)
                        if "hhi" in _det.columns:
                            _det["hhi"] = pd.to_numeric(_det["hhi"], errors="coerce").map(lambda x: f"{x:.4f}" if pd.notna(x) else "—")
                        _fcap = _pla.get("flag_column")
                        if _fcap and _fcap in _det.columns:
                            def _pl_fmt_flag(v):
                                if pd.isna(v) or v is None:
                                    return "—"
                                if v is True or v is np.bool_(True):
                                    return "Yes"
                                if v is False or v is np.bool_(False):
                                    return "No"
                                s = str(v).strip().lower()
                                return "Yes" if s in ("1", "true", "yes", "y") else "No"
                            _det[_fcap] = _det[_fcap].map(_pl_fmt_flag)
                        st.dataframe(_det, width="stretch", hide_index=True)

        # Post-loss rebalancing
        soft_hr()
        section_header("Post-Loss Rebalancing")
        _pl_from_runs = derive_post_loss_rebalancing_from_runs(runs) if len(postloss) == 0 else None
        if len(postloss) > 0:
            st.caption("From the optional **Post-loss rebalance** sheet in the workbook (pre-aggregated metrics).")
            c1, c2 = st.columns(2)
            with c1:
                labels_pl = [row.get("prompt_type", "").title() for _, row in postloss.iterrows()]
                after_loss = [row.get("avg_turnover_after_loss", 0) * 100 for _, row in postloss.iterrows()]
                after_gain = [row.get("avg_turnover_after_non_loss", 0) * 100 for _, row in postloss.iterrows()]

                fig = go.Figure()
                fig.add_trace(go.Bar(x=labels_pl, y=after_loss, name="After loss", marker_color=RED))
                fig.add_trace(go.Bar(x=labels_pl, y=after_gain, name="After gain", marker_color=GREEN))
                fig.update_layout(**PLOT_LAYOUT, title="Turnover: post-loss vs post-gain", barmode="group",
                                  yaxis_title="Turnover %")
                st.plotly_chart(fig, width="stretch")

            with c2:
                pct_after_loss = [row.get("pct_rebalances_after_loss", 0) * 100 for _, row in postloss.iterrows()]
                fig = go.Figure(go.Bar(
                    x=labels_pl, y=pct_after_loss,
                    marker_color=[RED, "#FB923C"][:len(labels_pl)],
                    text=[f"{v:.1f}%" if pd.notna(v) else "" for v in pct_after_loss],
                    textposition="auto",
                ))
                fig.update_layout(**PLOT_LAYOUT, title="% of rebalances following a loss period",
                                  yaxis_title="%", yaxis=dict(range=[0, 50]))
                st.plotly_chart(fig, width="stretch")
        elif _pl_from_runs is not None:
            st.caption(
                "There is **no separate Post-loss rebalance sheet** in this package (that is normal). "
                "Charts below use **Portfolio runs**: mean **`turnover`** when **`post_loss_rebalance`** is true vs false, "
                "and the share of rows flagged as post-loss rebalances."
            )
            c1, c2 = st.columns(2)
            with c1:
                labels_pl = _pl_from_runs["labels_pl"]
                after_loss = _pl_from_runs["after_loss"]
                after_gain = _pl_from_runs["after_gain"]
                fig = go.Figure()
                fig.add_trace(go.Bar(x=labels_pl, y=after_loss, name="Post-loss flag", marker_color=RED))
                fig.add_trace(go.Bar(x=labels_pl, y=after_gain, name="Other periods", marker_color=GREEN))
                fig.update_layout(**PLOT_LAYOUT, title="Turnover: post-loss vs other periods (Portfolio runs)", barmode="group",
                                  yaxis_title="Turnover %")
                st.plotly_chart(fig, width="stretch", key="pl_rebal_turnover_runs")
            with c2:
                pct_after_loss = _pl_from_runs["pct_after_loss"]
                _ymax = max(50.0, max(pct_after_loss) * 1.15) if pct_after_loss else 50.0
                fig = go.Figure(go.Bar(
                    x=labels_pl, y=pct_after_loss,
                    marker_color=[RED, "#FB923C"][:len(labels_pl)],
                    text=[f"{v:.1f}%" if pd.notna(v) else "" for v in pct_after_loss],
                    textposition="auto",
                ))
                fig.update_layout(**PLOT_LAYOUT, title="% of period rows flagged post-loss (Portfolio runs)",
                                  yaxis_title="%", yaxis=dict(range=[0, _ymax]))
                st.plotly_chart(fig, width="stretch", key="pl_rebal_pct_runs")
        else:
            st.markdown(
                "This block is for an **optional** Excel sheet (**Post-loss rebalance**) with pre-summarized turnover metrics. "
                "**Your package does not include that sheet** — that is expected for many exports."
            )
            st.success(
                "Use **Post-Loss Analysis** (above) for recovery and returns after losses. "
                "If **Portfolio runs** includes **`post_loss_rebalance`** and **`turnover`**, turnover charts will appear here automatically."
            )
            with st.expander("Optional sheet: names and columns (for custom packages)", expanded=False):
                st.markdown(
                    "**Recognized sheet names:** `Post-loss rebalance`, `Post loss rebalance`, "
                    "`Post-Loss Rebalance`, `post_loss_rebalance`.\n\n"
                    "**Columns:** `prompt_type`, `avg_turnover_after_loss`, `avg_turnover_after_non_loss`, "
                    "`pct_rebalances_after_loss` (0–1 fractions; turnover and % are shown ×100)."
                )

        # HHI and holdings distribution from runs
        if len(runs) > 0 and "hhi" in runs.columns and "prompt_type" in runs.columns:
            soft_hr()
            section_header("Concentration Over Time")
            gpt_runs = runs[runs["prompt_type"].isin(["retail", "advanced"]) & runs["hhi"].notna()].copy()
            if len(gpt_runs) > 0:
                c1, c2 = st.columns(2)
                with c1:
                    fig = go.Figure()
                    for pt, color in [("retail", ACCENT), ("advanced", "#FB923C")]:
                        subset = gpt_runs[gpt_runs["prompt_type"] == pt]
                        if len(subset) > 0:
                            agg = subset.groupby("period")["hhi"].mean().reset_index().sort_values("period")
                            fig.add_trace(go.Scatter(
                                x=agg["period"], y=agg["hhi"],
                                name=pt.title(), mode="lines+markers", line_shape=SCATTER_LINE_SHAPE,
                                line=dict(color=color, width=2), marker=dict(size=5),
                            ))
                    fig.update_layout(**PLOT_LAYOUT, title="Mean HHI over time (lower = more diversified)",
                                      yaxis_title="HHI")
                    st.plotly_chart(fig, width="stretch")

                with c2:
                    fig = go.Figure()
                    for pt, color in [("retail", ACCENT), ("advanced", "#FB923C")]:
                        subset = gpt_runs[gpt_runs["prompt_type"] == pt]
                        if len(subset) > 0 and "effective_n_holdings" in subset.columns:
                            agg = subset.groupby("period")["effective_n_holdings"].mean().reset_index().sort_values("period")
                            fig.add_trace(go.Scatter(
                                x=agg["period"], y=agg["effective_n_holdings"],
                                name=pt.title(), mode="lines+markers", line_shape=SCATTER_LINE_SHAPE,
                                line=dict(color=color, width=2), marker=dict(size=5),
                            ))
                    fig.update_layout(**PLOT_LAYOUT, title="Mean effective number of holdings",
                                      yaxis_title="# holdings")
                    st.plotly_chart(fig, width="stretch")


    with _rt_dd:
        section_header("Drawdown Analysis")

        if len(gpt_dd) > 0 and "max_drawdown" in gpt_dd.columns:
            dd_data = gpt_dd[["trajectory_id", "strategy_key", "prompt_type", "market", "max_drawdown"]].copy()
            dd_data["max_dd_pct"] = dd_data["max_drawdown"] * 100
            dd_data = dd_data.sort_values("max_dd_pct", ascending=False)

            _worst = dd_data["max_dd_pct"].max()
            _mean_dd = dd_data["max_dd_pct"].mean()
            _median_dd = dd_data["max_dd_pct"].median()
            _dd_cols = st.columns(4)
            with _dd_cols[0]:
                kpi_card("Worst Drawdown", fmtp(_worst), RED)
            with _dd_cols[1]:
                kpi_card("Mean Drawdown", fmtp(_mean_dd), AMBER)
            with _dd_cols[2]:
                kpi_card("Median Drawdown", fmtp(_median_dd), AMBER if _median_dd > 20 else GREEN)
            with _dd_cols[3]:
                kpi_card("Trajectories", str(len(dd_data)), ACCENT)
            soft_hr()

            fig = go.Figure(go.Bar(
                x=dd_data["trajectory_id"],
                y=dd_data["max_dd_pct"],
                marker_color=[ACCENT if pt == "retail" else "#FB923C" for pt in dd_data["prompt_type"]],
                text=[f"{v:.1f}%" for v in dd_data["max_dd_pct"]],
                textposition="auto",
                hovertext=[f"{row['trajectory_id']}<br>Market: {row['market']}<br>Max DD: {row['max_dd_pct']:.1f}%"
                           for _, row in dd_data.iterrows()],
            ))
            fig.update_layout(**PLOT_LAYOUT, title="Max drawdown per GPT trajectory (blue = retail, orange = advanced)",
                              xaxis=dict(tickangle=45), yaxis_title="Max drawdown %", height=450)
            st.plotly_chart(fig, width="stretch")

            # Distribution
            c1, c2 = st.columns(2)
            with c1:
                fig = go.Figure()
                for pt, label, color in [("retail", "Retail", ACCENT), ("advanced", "Advanced", "#FB923C")]:
                    subset = dd_data[dd_data["prompt_type"] == pt]["max_dd_pct"]
                    if len(subset) > 0:
                        fig.add_trace(go.Histogram(x=subset, name=label, marker_color=color, opacity=0.7, nbinsx=12))
                fig.update_layout(**PLOT_LAYOUT, title="Drawdown distribution", barmode="overlay",
                                  xaxis_title="Max drawdown %", yaxis_title="Count")
                st.plotly_chart(fig, width="stretch")

            with c2:
                market_dd = dd_data.groupby(["market", "prompt_type"])["max_dd_pct"].mean().reset_index()
                fig = go.Figure()
                for pt, label, color in [("retail", "Retail", ACCENT), ("advanced", "Advanced", "#FB923C")]:
                    subset = market_dd[market_dd["prompt_type"] == pt]
                    if len(subset) > 0:
                        fig.add_trace(go.Bar(
                            x=[MARKET_LABELS.get(m, m) for m in subset["market"]],
                            y=subset["max_dd_pct"],
                            name=label, marker_color=color,
                        ))
                fig.update_layout(**PLOT_LAYOUT, title="Mean max drawdown by market", barmode="group",
                                  yaxis_title="Max drawdown %")
                st.plotly_chart(fig, width="stretch")

            # Benchmark drawdowns
            if len(strat_paths) > 0 and "max_drawdown" in strat_paths.columns:
                section_header("Benchmark Drawdowns")
                bench_dd = strat_paths[["strategy_key", "market", "max_drawdown"]].copy()
                bench_dd["max_dd_pct"] = bench_dd["max_drawdown"] * 100

                fig = go.Figure()
                for skey in ["mean_variance", "equal_weight", "sixty_forty", "index"]:
                    subset = bench_dd[bench_dd["strategy_key"] == skey]
                    if len(subset) > 0:
                        fig.add_trace(go.Bar(
                            x=[MARKET_LABELS.get(m, m) for m in subset["market"]],
                            y=subset["max_dd_pct"],
                            name=skey.replace("_", " ").title(),
                            marker_color=STRATEGY_COLORS.get(skey, "#5E7082"),
                        ))
                fig.update_layout(**PLOT_LAYOUT, title="Benchmark max drawdowns by market", barmode="group",
                                  yaxis_title="Max drawdown %")
                st.plotly_chart(fig, width="stretch")

            # GPT drawdown insights
            section_header("Drawdown Insights")
            worst = dd_data.sort_values("max_dd_pct", ascending=False).iloc[0]
            best_protected = dd_data[dd_data["max_dd_pct"] == 0]
            avg_retail_dd = dd_data[dd_data["prompt_type"] == "retail"]["max_dd_pct"].mean()
            avg_adv_dd = dd_data[dd_data["prompt_type"] == "advanced"]["max_dd_pct"].mean()

            insight_card("neg", f"Worst drawdown: {worst['trajectory_id']}",
                         f"{worst['max_dd_pct']:.1f}% max drawdown in the {worst['market'].upper()} market.")

            if len(best_protected) > 0:
                names = ", ".join(best_protected["trajectory_id"].tolist())
                insight_card("pos", f"{len(best_protected)} trajectories with zero drawdown", names)

            if avg_retail_dd > avg_adv_dd:
                insight_card("info", "Advanced prompting provides better downside protection",
                             f"Mean max DD: Retail {avg_retail_dd:.1f}% vs Advanced {avg_adv_dd:.1f}%")
            else:
                insight_card("info", "Retail prompting has comparable drawdown profile",
                             f"Mean max DD: Retail {avg_retail_dd:.1f}% vs Advanced {avg_adv_dd:.1f}%")

        else:
            st.info("No drawdown data found.")


# ══════════════════════════════════════════
# DATA QUALITY
# ══════════════════════════════════════════

def run_sanity_checks(D, runs):
    """Run comprehensive rule-based sanity checks across all data sheets."""
    issues = []
    passes = []

    # ── Portfolio runs checks ──
    if len(runs) > 0:
        # Missing values in critical columns
        critical = ["market", "period", "sharpe_ratio", "net_return"]
        for col in critical:
            if col in runs.columns:
                n_miss = runs[col].isna().sum()
                if n_miss > 0:
                    issues.append(("warn", f"Missing values", f"`{col}` has {n_miss} missing values ({n_miss/len(runs)*100:.1f}% of {len(runs)} runs)"))
                else:
                    passes.append(f"`{col}`: no missing values")

        # Sharpe ratio sanity
        if "sharpe_ratio" in runs.columns:
            sr = runs["sharpe_ratio"].dropna()
            extreme_sr = sr[(sr > 10) | (sr < -10)]
            if len(extreme_sr) > 0:
                issues.append(("neg", "Extreme Sharpe ratios", f"{len(extreme_sr)} runs have |Sharpe| > 10 (max: {sr.max():.2f}, min: {sr.min():.2f}). Verify these are not data errors."))
            else:
                passes.append(f"All Sharpe ratios within reasonable range [{sr.min():.2f}, {sr.max():.2f}]")

        # Return sanity
        ret_col = "net_return" if "net_return" in runs.columns else (
            "period_return_net" if "period_return_net" in runs.columns else (
                "period_return" if "period_return" in runs.columns else None
            )
        )
        if ret_col:
            ret = runs[ret_col].dropna()
            extreme_ret = ret[(ret > 2) | (ret < -0.9)]
            if len(extreme_ret) > 0:
                issues.append(("warn", "Extreme returns", f"{len(extreme_ret)} runs have returns > 200% or < -90%. Max: {ret.max()*100:.1f}%, Min: {ret.min()*100:.1f}%"))
            else:
                passes.append(f"All returns within plausible range [{ret.min()*100:.1f}%, {ret.max()*100:.1f}%]")

        # HHI range check [0, 1]
        if "hhi" in runs.columns:
            hhi = runs["hhi"].dropna()
            bad_hhi = hhi[(hhi < 0) | (hhi > 1)]
            if len(bad_hhi) > 0:
                issues.append(("neg", "HHI out of range", f"{len(bad_hhi)} runs have HHI outside [0, 1]"))
            else:
                passes.append(f"All HHI values within valid range [0, 1]")

        # Market/period coverage
        if "market" in runs.columns and "period" in runs.columns:
            coverage = runs.groupby("market")["period"].nunique()
            max_periods = coverage.max()
            for mkt, n_per in coverage.items():
                if n_per < max_periods:
                    issues.append(("warn", f"Incomplete coverage: {mkt}", f"Only {n_per}/{max_periods} periods have data"))
            if (coverage == max_periods).all():
                passes.append(f"All {len(coverage)} markets have complete period coverage ({max_periods} periods each)")

        # Valid flag check
        if "valid" in runs.columns:
            n_invalid = (runs["valid"] == False).sum()
            if n_invalid > 0:
                issues.append(("warn", "Invalid runs", f"{n_invalid} runs flagged as invalid ({n_invalid/len(runs)*100:.1f}%)"))
            else:
                passes.append("All runs flagged as valid")

        # Duplicate run check
        id_col = _preferred_run_identifier_column(runs.columns)
        if id_col:
            dups = runs[runs.duplicated(subset=[id_col, "period", "market"], keep=False)] if "period" in runs.columns and "market" in runs.columns else pd.DataFrame()
            if len(dups) > 0:
                issues.append(("neg", "Duplicate runs", f"{len(dups)} duplicate entries found by ({id_col}, period, market)"))
            else:
                passes.append("No duplicate runs detected")

    # ── Statistical tests checks ──
    stats = D.get("stats", pd.DataFrame())
    if len(stats) > 0:
        if "p_value" in stats.columns:
            bad_p = stats[(stats["p_value"] < 0) | (stats["p_value"] > 1)]
            if len(bad_p) > 0:
                issues.append(("neg", "Invalid p-values", f"{len(bad_p)} tests have p-values outside [0, 1]"))
            else:
                passes.append("All p-values within valid range [0, 1]")

        if "n_obs" in stats.columns:
            low_n = stats[stats["n_obs"] < 10]
            if len(low_n) > 0:
                issues.append(("warn", "Low sample size tests", f"{len(low_n)} statistical tests have n < 10, results may be unreliable"))

    # ── Strategy summary checks ──
    summary = D.get("summary", pd.DataFrame())
    if len(summary) > 0:
        if "n_observations" in summary.columns:
            low_obs = summary[summary["n_observations"] < 5]
            if len(low_obs) > 0:
                names = ", ".join(low_obs["Strategy"].tolist())
                issues.append(("warn", "Low observation count", f"Strategies with < 5 observations: {names}"))

    # ── Data quality sheet checks ──
    dq_df = D.get("data_quality", pd.DataFrame())
    if len(dq_df) > 0:
        for pct_col in ["fundamentals_pti_valid_pct_equity", "trailing_6m_return_coverage_pct", "pe_coverage_pct_equity"]:
            if pct_col in dq_df.columns:
                low_cov = dq_df[dq_df[pct_col] < 90]
                if len(low_cov) > 0:
                    pairs = [f"{r['market']}/{r['period']}" for _, r in low_cov.iterrows()]
                    issues.append(("warn", f"Low coverage: {pct_col.replace('_', ' ')}", f"Below 90% for: {', '.join(pairs[:5])}{'...' if len(pairs) > 5 else ''}"))
                else:
                    passes.append(f"`{pct_col}` >= 90% for all market-periods")

        if "news_items_total" in dq_df.columns:
            zero_news = dq_df[dq_df["news_items_total"] == 0]
            if len(zero_news) > 0:
                pairs = [f"{r['market']}/{r['period']}" for _, r in zero_news.iterrows()]
                issues.append(("neg", "Zero news items", f"No news data for: {', '.join(pairs)}"))

    # ── Post-loss rebalance sheet ──
    postloss_df = D.get("postloss", pd.DataFrame())
    _req_pl = ["prompt_type", "avg_turnover_after_loss", "avg_turnover_after_non_loss", "pct_rebalances_after_loss"]
    if len(postloss_df) == 0:
        passes.append("Post-loss sheet: absent or empty (optional — charts in Tests & risk → Behavior are hidden)")
    else:
        miss = [c for c in _req_pl if c not in postloss_df.columns]
        if miss:
            issues.append(
                (
                    "warn",
                    "Post-loss sheet incomplete",
                    f"Missing columns: {', '.join('`%s`' % m for m in miss)}. Common headers are mapped on load; see Behavior tab for the expected schema.",
                )
            )
        else:
            passes.append(f"Post-loss sheet: {len(postloss_df)} row(s), required columns present")
            for c in _req_pl[1:]:
                if c in postloss_df.columns and postloss_df[c].notna().sum() == 0:
                    issues.append(
                        ("warn", f"Post-loss: `{c}` all null", "No non-null values in this column — charts may show zeros."),
                    )

    # ── Cross-sheet consistency ──
    if len(runs) > 0 and len(summary) > 0:
        run_markets = set(runs["market"].dropna().unique()) if "market" in runs.columns else set()
        if "strategy_key" in summary.columns:
            passes.append(f"Cross-sheet: {len(summary)} strategies in summary, {len(run_markets)} markets in runs")

    if not issues:
        passes.append("No issues found — all sanity checks passed")

    return issues, passes


def _df_to_md(df, max_rows=30):
    """Convert a DataFrame to a markdown table without requiring tabulate."""
    if len(df) == 0:
        return "(empty)"
    df = df.head(max_rows)
    cols = df.columns.tolist()
    header = "| " + " | ".join(str(c) for c in cols) + " |"
    sep = "| " + " | ".join("---" for _ in cols) + " |"
    rows = []
    for _, row in df.iterrows():
        vals = []
        for c in cols:
            v = row[c]
            if pd.isna(v):
                vals.append("")
            elif isinstance(v, float):
                vals.append(f"{v:.4f}" if abs(v) < 100 else f"{v:.1f}")
            else:
                vals.append(str(v)[:80])
        rows.append("| " + " | ".join(vals) + " |")
    return "\n".join([header, sep] + rows)


def _build_query_context(query, D, runs):
    """Detect topic from user query and inject relevant data rows as context."""
    import re as _re_ctx
    q = query.lower()
    blocks = []
    rl = D.get("runs_long", pd.DataFrame())

    ret_col = next((c for c in ["net_return", "period_return_net", "period_return"] if c in runs.columns), None) if len(runs) > 0 else None
    id_col = next((c for c in ["trajectory_id", "run_id", "portfolio_id"] if c in runs.columns), None) if len(runs) > 0 else None

    # --- Market detection ---
    _market_aliases = {
        "us": ["us ", "u.s.", "united states", "s&p", "sp500", "american market"],
        "germany": ["germany", "german", "dax", "european market"],
        "japan": ["japan", "japanese", "nikkei", "tokyo"],
    }
    detected_markets = []
    for mkt_key, aliases in _market_aliases.items():
        if any(alias in q for alias in aliases):
            detected_markets.append(mkt_key)

    if detected_markets and len(runs) > 0 and "market" in runs.columns:
        for mkt in detected_markets:
            mkt_runs = runs[runs["market"] == mkt]
            if len(mkt_runs) > 0:
                show_cols = [c for c in [id_col, "market", "period", "prompt_type", "sharpe_ratio", ret_col, "hhi", "effective_n_holdings"] if c and c in mkt_runs.columns]
                blocks.append(f"### Runs for market: {mkt} ({len(mkt_runs)} rows)\n\n{_df_to_md(mkt_runs[show_cols])}")

    # --- Ticker detection ---
    if len(rl) > 0 and "holding_ticker" in rl.columns:
        known_tickers = set(rl["holding_ticker"].dropna().str.upper().unique())
        words = set(_re_ctx.findall(r'\b[A-Z]{1,5}\b', query.upper()))
        matched_tickers = words & known_tickers
        if matched_tickers:
            for ticker in sorted(matched_tickers)[:5]:
                ticker_rows = rl[rl["holding_ticker"].str.upper() == ticker]
                if len(ticker_rows) > 0:
                    show_cols = [c for c in [id_col, "market", "period", "prompt_type", "holding_ticker", "holding_name", "holding_weight", "holding_sector", "holding_entry_price", "holding_current_price", "holding_return"] if c and c in ticker_rows.columns]
                    blocks.append(f"### Holdings for ticker: {ticker} ({len(ticker_rows)} rows)\n\n{_df_to_md(ticker_rows[show_cols], max_rows=50)}")

    # --- Prompt type comparison ---
    _prompt_kw = ["retail vs advanced", "advanced vs retail", "compare prompt", "prompt type", "prompt comparison", "retail prompt", "advanced prompt", "which prompt"]
    if any(kw in q for kw in _prompt_kw) and len(runs) > 0 and "prompt_type" in runs.columns:
        rows_cmp = []
        for pt in sorted(runs["prompt_type"].dropna().unique()):
            sub = runs[runs["prompt_type"] == pt]
            row_d = {"prompt_type": pt, "n_runs": len(sub)}
            for col in ["sharpe_ratio", "hhi", "effective_n_holdings"]:
                if col in sub.columns:
                    s = sub[col].dropna()
                    row_d[f"mean_{col}"] = s.mean() if len(s) > 0 else np.nan
            if ret_col and ret_col in sub.columns:
                r = sub[ret_col].dropna()
                row_d["mean_return"] = r.mean() if len(r) > 0 else np.nan
                row_d["win_rate_%"] = ((r > 0).sum() / len(r) * 100) if len(r) > 0 else np.nan
            rows_cmp.append(row_d)
        if rows_cmp:
            blocks.append(f"### Prompt Type Comparison\n\n{_df_to_md(pd.DataFrame(rows_cmp))}")

    # --- Period detection ---
    if len(runs) > 0 and "period" in runs.columns:
        for per in runs["period"].dropna().unique():
            per_lower = str(per).lower()
            if per_lower in q or per_lower.replace("-", " ") in q or per_lower.replace("_", " ") in q:
                per_runs = runs[runs["period"] == per]
                if len(per_runs) > 0:
                    show_cols = [c for c in [id_col, "market", "period", "prompt_type", "sharpe_ratio", ret_col, "hhi"] if c and c in per_runs.columns]
                    blocks.append(f"### Runs for period: {per} ({len(per_runs)} rows)\n\n{_df_to_md(per_runs[show_cols])}")
                break

    # --- Post-loss / drawdown ---
    _loss_kw = ["loss", "drawdown", "negative return", "post-loss", "after loss", "recovery", "losing"]
    if any(kw in q for kw in _loss_kw) and len(runs) > 0 and ret_col and id_col:
        has_prompt = "prompt_type" in runs.columns
        gpt_runs = runs[runs["prompt_type"].isin(["retail", "advanced"])].copy() if has_prompt else runs.copy()
        after_loss_rows, loss_rows = [], []
        for traj in gpt_runs[id_col].dropna().unique():
            traj_data = gpt_runs[gpt_runs[id_col] == traj].sort_values("period")
            prev_ret = None
            for _, row in traj_data.iterrows():
                cur_ret = row.get(ret_col, np.nan)
                if prev_ret is not None and pd.notna(prev_ret) and prev_ret < 0:
                    after_loss_rows.append(row)
                if pd.notna(cur_ret) and cur_ret < 0:
                    loss_rows.append(row)
                prev_ret = cur_ret
        if loss_rows:
            loss_df = pd.DataFrame(loss_rows)
            show_cols = [c for c in [id_col, "market", "period", "prompt_type", "sharpe_ratio", ret_col, "hhi"] if c and c in loss_df.columns]
            blocks.append(f"### Loss periods ({len(loss_df)} runs with negative returns)\n\n{_df_to_md(loss_df[show_cols])}")
        if after_loss_rows:
            al_df = pd.DataFrame(after_loss_rows)
            al_df["recovered"] = al_df[ret_col].apply(lambda v: "Yes" if pd.notna(v) and v > 0 else "No")
            show_cols = [c for c in [id_col, "market", "period", "prompt_type", "sharpe_ratio", ret_col, "hhi", "recovered"] if c and c in al_df.columns]
            blocks.append(f"### After-loss runs ({len(al_df)} runs following a loss)\n\n{_df_to_md(al_df[show_cols])}")

    # --- Reasoning / GPT analysis ---
    _reason_kw = ["reasoning", "rationale", "explanation", "gpt decision", "gpt reasoning", "why did gpt", "portfolio logic", "decision-making", "thought process"]
    if any(kw in q for kw in _reason_kw) and len(runs) > 0:
        reasoning_cols = [c for c in runs.columns if any(
            kw in c.lower() for kw in ["reason", "rational", "explanation", "response", "gpt_response",
                                         "justification", "analysis", "commentary", "narrative", "thinking",
                                         "decision", "rationale", "prompt_response", "llm_output", "output_text",
                                         "summary", "reasoning_summary"]
        )]
        if reasoning_cols:
            rc = reasoning_cols[0]
            gpt_runs = runs[runs["prompt_type"].isin(["retail", "advanced"])].copy() if "prompt_type" in runs.columns else runs.copy()
            gpt_with_text = gpt_runs[gpt_runs[rc].notna() & (gpt_runs[rc].astype(str).str.len() > 20)]
            if len(gpt_with_text) > 0:
                sample = gpt_with_text.sample(min(20, len(gpt_with_text)), random_state=42)
                parts = []
                for _, row in sample.iterrows():
                    run_lbl = row.get(id_col, "?") if id_col else "?"
                    mkt = row.get("market", "?")
                    per = row.get("period", "?")
                    pt = row.get("prompt_type", "?")
                    sr = row.get("sharpe_ratio", np.nan)
                    sr_str = f"{sr:.2f}" if pd.notna(sr) else "N/A"
                    text = str(row[rc])[:600]
                    parts.append(f"**[{run_lbl}] {mkt}/{per} ({pt}) Sharpe={sr_str}**\n{text}")
                blocks.append(f"### GPT Reasoning Samples ({len(sample)} runs)\n\n" + "\n\n---\n\n".join(parts))

    # --- Regime / macro ---
    _regime_kw = ["regime", "bull", "bear", "volatility regime", "rate regime", "macro", "market condition",
                  "tightening", "easing", "market environment", "economic environment", "vol regime"]
    regime = D.get("regime", pd.DataFrame())
    if any(kw in q for kw in _regime_kw) and len(regime) > 0:
        regime_show = regime[["Period", "Market", "Return_%", "Market_Label", "Avg_Vol", "Vol_Label", "Yield_Chg_bp", "Rate_Label"]].copy()
        regime_show.columns = ["Period", "Market", "Return%", "Trend", "AvgVol", "VolRegime", "YieldChg_bp", "RateRegime"]
        blocks.append(f"### Market Regime Labels (all periods)\n\n{_df_to_md(regime_show)}")
        if detected_markets:
            mkt_code_map = {"us": "US", "germany": "DE", "japan": "JP"}
            for mkt in detected_markets:
                code = mkt_code_map.get(mkt, mkt.upper())
                mkt_regime = regime[regime["Market"] == code]
                if len(mkt_regime) > 0 and len(runs) > 0 and "market" in runs.columns:
                    mkt_runs = runs[runs["market"] == mkt]
                    if len(mkt_runs) > 0 and "Market_Label" in mkt_runs.columns:
                        show_cols = [c for c in [id_col, "market", "period", "prompt_type", "sharpe_ratio", ret_col, "Market_Label", "Vol_Label"] if c and c in mkt_runs.columns]
                        blocks.append(f"### {mkt} runs with regime labels ({len(mkt_runs)} rows)\n\n{_df_to_md(mkt_runs[show_cols])}")

    # --- Holdings / weights ---
    _hold_kw = ["holding", "weight", "stock", "position", "allocation", "portfolio composition", "concentration", "diversif"]
    if any(kw in q for kw in _hold_kw) and len(rl) > 0:
        if "holding_ticker" in rl.columns:
            top = rl["holding_ticker"].value_counts().head(15)
            top_md = "| Ticker | Count |\n| --- | --- |\n" + "\n".join(f"| {t} | {c} |" for t, c in top.items())
            blocks.append(f"### Most frequent holdings across all portfolios\n\n{top_md}")
        if "holding_weight" in rl.columns and "prompt_type" in rl.columns:
            w_parts = []
            for pt in sorted(rl["prompt_type"].dropna().unique()):
                pt_rl = rl[rl["prompt_type"] == pt]
                w = pd.to_numeric(pt_rl["holding_weight"], errors="coerce").dropna()
                if len(w) > 0:
                    mul = 100 if w.max() <= 1 else 1
                    n_tick = pt_rl["holding_ticker"].nunique() if "holding_ticker" in pt_rl.columns else "?"
                    w_parts.append(f"- **{pt}**: avg weight {w.mean()*mul:.1f}%, max {w.max()*mul:.1f}%, {n_tick} unique tickers")
            if w_parts:
                blocks.append("### Weight distribution by prompt type\n\n" + "\n".join(w_parts))

    if not blocks:
        return ""

    result = "\n\n".join(blocks)
    if len(result) > 30_000:
        result = result[:30_000] + "\n\n[... CONTEXT TRUNCATED ...]"
    return f"\n\n[RELEVANT DATA FOR THIS QUESTION]\n\n{result}"


def build_data_profile(D, runs, sanity_result=None):
    """Build a structured data profile for the AI assistant.

    Focuses on pre-computed comparisons and key findings rather than
    raw data dumps.  Reasoning text is excluded here and injected
    dynamically by _build_query_context when the user asks about it.

    If ``sanity_result`` is ``(issues, passes)`` from ``run_sanity_checks``, that pass is skipped
    (same text in the profile, avoids duplicate work).
    """
    lines = []
    ret_col = next((c for c in ["net_return", "period_return_net", "period_return"] if c in runs.columns), None) if len(runs) > 0 else None
    id_col = next((c for c in ["trajectory_id", "run_id", "portfolio_id"] if c in runs.columns), None) if len(runs) > 0 else None

    # ── 1. Dataset overview ──
    lines.append("## Dataset Overview\n")
    sheet_parts = []
    for key, df in D.items():
        if isinstance(df, pd.DataFrame) and len(df) > 0:
            sheet_parts.append(f"- **{key}**: {len(df)} rows, {len(df.columns)} cols")
    lines.append("\n".join(sheet_parts) if sheet_parts else "No sheets loaded.")

    if len(runs) > 0:
        markets = sorted(runs["market"].dropna().unique().tolist()) if "market" in runs.columns else []
        periods = sorted(runs["period"].dropna().unique().tolist()) if "period" in runs.columns else []
        prompts = sorted(runs["prompt_type"].dropna().unique().tolist()) if "prompt_type" in runs.columns else []
        lines.append(f"\n**Portfolio runs**: {len(runs)} total")
        if markets:
            lines.append(f"- Markets ({len(markets)}): {', '.join(str(m) for m in markets)}")
        if periods:
            lines.append(f"- Periods ({len(periods)}): {', '.join(str(p) for p in periods)}")
        if prompts:
            lines.append(f"- Prompt types: {', '.join(prompts)}")

    # ── 1b. Regime context ──
    regime = D.get("regime", pd.DataFrame())
    if len(regime) > 0:
        lines.append("\n## Market Regimes\n")
        lines.append("Classification: Bull (>5%), Bear (<-5%), Flat; Vol Low (<16), Elevated, High (>25); Rate Tightening (>50bp), Easing (<-50bp), Stable\n")
        regime_show = regime[["Period", "Market", "Return_%", "Market_Label", "Avg_Vol", "Vol_Label", "Yield_Chg_bp", "Rate_Label"]].copy()
        regime_show.columns = ["Period", "Market", "Return%", "Trend", "AvgVol", "VolRegime", "YieldChg_bp", "RateRegime"]
        lines.append(_df_to_md(regime_show))

        # Per-market regime summary for quick AI reference
        mkt_map_rev = {"us": "US", "germany": "DE", "japan": "JP"}
        for mkt_key, mkt_code in mkt_map_rev.items():
            mkt_regime = regime[regime["Market"] == mkt_code].sort_values("Period")
            if len(mkt_regime) > 0:
                trend_seq = " → ".join(mkt_regime["Market_Label"].tolist())
                n_bull = (mkt_regime["Market_Label"] == "Bull").sum()
                n_bear = (mkt_regime["Market_Label"] == "Bear").sum()
                lines.append(f"- **{mkt_key}** regime sequence: {trend_seq} ({n_bull} bull, {n_bear} bear)")

    # ── 2. Pre-computed prompt-type comparison (KEY FINDING) ──
    if len(runs) > 0 and "prompt_type" in runs.columns:
        lines.append("\n## Prompt Type Comparison\n")
        cmp_rows = []
        for pt in sorted(runs["prompt_type"].dropna().unique()):
            sub = runs[runs["prompt_type"] == pt]
            n = len(sub)
            d = {"Prompt": pt, "n": n}
            if "sharpe_ratio" in sub.columns:
                sr = sub["sharpe_ratio"].dropna()
                d["Mean Sharpe"] = f"{sr.mean():.3f}" if len(sr) > 0 else "N/A"
                d["Std Sharpe"] = f"{sr.std():.3f}" if len(sr) > 0 else "N/A"
            if ret_col and ret_col in sub.columns:
                r = sub[ret_col].dropna()
                d["Mean Return"] = f"{r.mean():.4f}" if len(r) > 0 else "N/A"
                d["Win Rate"] = f"{(r > 0).sum() / len(r) * 100:.1f}%" if len(r) > 0 else "N/A"
            if "hhi" in sub.columns:
                h = sub["hhi"].dropna()
                d["Mean HHI"] = f"{h.mean():.3f}" if len(h) > 0 else "N/A"
            if "effective_n_holdings" in sub.columns:
                e = sub["effective_n_holdings"].dropna()
                d["Mean Eff. Holdings"] = f"{e.mean():.1f}" if len(e) > 0 else "N/A"
            cmp_rows.append(d)
        if cmp_rows:
            lines.append(_df_to_md(pd.DataFrame(cmp_rows)))
            if len(cmp_rows) >= 2 and "sharpe_ratio" in runs.columns:
                srs = {r["Prompt"]: runs[runs["prompt_type"] == r["Prompt"]]["sharpe_ratio"].dropna().mean() for r in cmp_rows}
                best_pt = max(srs, key=srs.get)
                worst_pt = min(srs, key=srs.get)
                if srs[worst_pt] != 0:
                    pct_diff = (srs[best_pt] - srs[worst_pt]) / abs(srs[worst_pt]) * 100
                    lines.append(f"\n**KEY FINDING**: {best_pt} Sharpe ({srs[best_pt]:.3f}) exceeds {worst_pt} ({srs[worst_pt]:.3f}) by {pct_diff:+.0f}%")

    # ── 3. Per-market breakdown ──
    if len(runs) > 0 and "market" in runs.columns:
        lines.append("\n## Per-Market Performance\n")
        mkt_rows = []
        for mkt in sorted(runs["market"].dropna().unique()):
            sub = runs[runs["market"] == mkt]
            d = {"Market": mkt, "n": len(sub)}
            if "sharpe_ratio" in sub.columns:
                sr = sub["sharpe_ratio"].dropna()
                d["Mean Sharpe"] = f"{sr.mean():.3f}" if len(sr) > 0 else "N/A"
            if ret_col and ret_col in sub.columns:
                r = sub[ret_col].dropna()
                d["Mean Return"] = f"{r.mean():.4f}" if len(r) > 0 else "N/A"
                d["Win Rate"] = f"{(r > 0).sum() / len(r) * 100:.1f}%" if len(r) > 0 else "N/A"
            if "hhi" in sub.columns:
                h = sub["hhi"].dropna()
                d["Mean HHI"] = f"{h.mean():.3f}" if len(h) > 0 else "N/A"
            mkt_rows.append(d)
        if mkt_rows:
            lines.append(_df_to_md(pd.DataFrame(mkt_rows)))

    # ── 4. Best & worst runs ──
    if len(runs) > 0 and "sharpe_ratio" in runs.columns:
        lines.append("\n## Best & Worst Runs by Sharpe\n")
        show = [c for c in [id_col, "market", "period", "prompt_type", "sharpe_ratio", ret_col, "hhi"] if c and c in runs.columns]
        best5 = runs.nlargest(5, "sharpe_ratio")
        worst5 = runs.nsmallest(5, "sharpe_ratio")
        lines.append("**Top 5:**\n")
        lines.append(_df_to_md(best5[show]))
        lines.append("\n**Bottom 5:**\n")
        lines.append(_df_to_md(worst5[show]))

    # ── 5. Strategy summary ──
    summary = D.get("summary", pd.DataFrame())
    if len(summary) > 0:
        lines.append("\n## Strategy Summary\n")
        s_rows = []
        for _, row in summary.iterrows():
            d = {"Strategy": row.get("Strategy", "?")}
            d["Mean Sharpe"] = f"{row.get('mean_sharpe', np.nan):.3f}" if pd.notna(row.get("mean_sharpe")) else "N/A"
            d["Mean Return"] = f"{row.get('net_return_mean', np.nan):.4f}" if pd.notna(row.get("net_return_mean")) else "N/A"
            d["n"] = int(row.get("n_observations", 0))
            beat = row.get("pct_runs_beating_index_sharpe", np.nan)
            d["Beat Index %"] = f"{beat:.1f}%" if pd.notna(beat) else "N/A"
            s_rows.append(d)
        lines.append(_df_to_md(pd.DataFrame(s_rows)))

    # ── 6. Statistical tests ──
    stats = D.get("stats", pd.DataFrame())
    if len(stats) > 0:
        lines.append(f"\n## Statistical Tests ({len(stats)} tests)\n")
        for _, row in stats.iterrows():
            sig = " **SIGNIFICANT**" if row.get("significant_5pct") else ""
            lines.append(f"- {row.get('strategy','?')} vs {row.get('benchmark','?')} ({row.get('metric','?')}): t={row.get('t_stat',0):.2f}, p={row.get('p_value',1):.4f}{sig}")

    # ── 7. Post-loss analysis ──
    pl_sum = compute_post_loss_analysis_from_runs(runs)
    if pl_sum is not None and (pl_sum["n_loss_periods"] > 0 or pl_sum.get("n_after_loss", 0) > 0):
        lines.append("\n## Post-Loss Analysis\n")
        lines.append(f"- Source: **{pl_sum.get('source', 'n/a')}**")
        lines.append(f"- Loss periods (negative return): **{pl_sum['n_loss_periods']}**")
        lines.append(f"- After-loss / post-loss reaction periods: **{pl_sum['n_after_loss']}**")
        if pl_sum["n_after_loss"] > 0 and pd.notna(pl_sum.get("after_loss_mean_return")):
            lines.append(f"- After-loss mean return: **{pl_sum['after_loss_mean_return']:.4f}**")
        if pl_sum["n_after_loss"] > 0 and pd.notna(pl_sum.get("recovery_pct")):
            lines.append(f"- **KEY FINDING**: Recovery rate (positive return after loss): **{pl_sum['recovery_pct']:.1f}%**")
        if pd.notna(pl_sum.get("hhi_diff")):
            lines.append(
                f"- HHI after loss: {pl_sum['hhi_after']:.4f} vs other periods: {pl_sum['hhi_other']:.4f} "
                f"(diff: {pl_sum['hhi_diff']:+.4f})"
            )
        for row in pl_sum.get("by_prompt", []):
            mr = row.get("Mean return", np.nan)
            mr_s = f"{mr:.4f}" if pd.notna(mr) else "N/A"
            rc = row.get("Recovery %", np.nan)
            rc_s = f"{rc:.0f}%" if pd.notna(rc) else "N/A"
            lines.append(
                f"- {row['Prompt']}: {row['After-loss periods']} after-loss periods, recovery={rc_s}, mean_ret={mr_s}"
            )
        plq = qualitative_post_loss_reasoning(runs, pl_sum)
        if plq:
            lines.append("\n**Post-loss portfolio reasoning (qualitative skim)**\n")
            lines.append(
                f"- After-loss rows in merge: **{plq['n_after_loss_rows']}** · with non-empty reasoning: **{plq['n_with_reasoning']}**"
            )
            if plq.get("reasoning_cols"):
                lines.append(f"- Reasoning columns used: {', '.join(str(c) for c in plq['reasoning_cols'][:8])}")
            _tcz = plq.get("theme_counts") or {}
            _tc_line = ", ".join(f"{k}: {v}" for k, v in _tcz.items() if v > 0)
            if _tc_line:
                lines.append(f"- Keyword theme row-hits: {_tc_line}")
            for e in (plq.get("excerpts") or [])[:4]:
                _ex = str(e.get("Excerpt", ""))[:300].replace("\n", " ")
                lines.append(
                    f"  - `{e.get('Trajectory')} · {e.get('Period')}` ({e.get('Prompt')}): {_ex}"
                )

    # ── 8. Portfolio behavior ──
    behavior = D.get("behavior", pd.DataFrame())
    if len(behavior) > 0:
        lines.append("\n## Portfolio Behavior by Prompt Type\n")
        for _, row in behavior.iterrows():
            pt = row.get("prompt_type", "?")
            lines.append(f"- **{pt}**: HHI={row.get('mean_hhi',0):.3f}, eff_holdings={row.get('mean_effective_n_holdings',0):.1f}, turnover={row.get('mean_turnover',0):.3f}")

    postloss_df = D.get("postloss", pd.DataFrame())
    if len(postloss_df) > 0:
        lines.append("\n## Post-Loss Rebalancing\n")
        for _, row in postloss_df.iterrows():
            pt = row.get("prompt_type", "?")
            lines.append(f"- **{pt}**: turnover after loss={row.get('avg_turnover_after_loss', 0):.3f}, after gain={row.get('avg_turnover_after_non_loss', 0):.3f}, rebalance_rate={row.get('pct_rebalances_after_loss', 0)*100:.1f}%")

    # ── 9. Holdings overview ──
    rl = D.get("runs_long", pd.DataFrame())
    if len(rl) > 0:
        lines.append(f"\n## Holdings Overview ({len(rl)} line-items)\n")
        if "holding_ticker" in rl.columns:
            lines.append(f"- Unique tickers: {rl['holding_ticker'].nunique()}")
        if "holding_sector" in rl.columns:
            sectors = sorted(rl["holding_sector"].dropna().unique())
            lines.append(f"- Sectors ({len(sectors)}): {', '.join(str(s) for s in sectors[:15])}")
        avail = []
        if "holding_entry_price" in rl.columns:
            avail.append("entry_price")
        if "holding_current_price" in rl.columns:
            avail.append("current_price")
        if "holding_weight" in rl.columns:
            avail.append("weight")
        if avail:
            lines.append(f"- Available data: {', '.join(avail)}")

    # ── 10. Reasoning columns available ──
    reasoning_cols = [c for c in runs.columns if any(
        kw in c.lower() for kw in ["reason", "rational", "explanation", "response", "gpt_response",
                                     "justification", "analysis", "commentary", "narrative", "thinking",
                                     "decision", "rationale", "prompt_response", "llm_output", "output_text",
                                     "summary", "reasoning_summary"]
    )] if len(runs) > 0 else []
    if reasoning_cols:
        lines.append(f"\n## GPT Reasoning Data\n")
        lines.append(f"- Reasoning columns: {', '.join(reasoning_cols)}")
        gpt_with_text = runs[runs[reasoning_cols[0]].notna()] if len(runs) > 0 else pd.DataFrame()
        lines.append(f"- Runs with reasoning text: {len(gpt_with_text)} / {len(runs)}")
        lines.append("- *(Full reasoning text is injected dynamically when you ask about it)*")
    else:
        lines.append("\n## GPT Reasoning Data\n")
        lines.append("- No reasoning columns found in data.")

    # ── 11. Data quality ──
    dq_df = D.get("data_quality", pd.DataFrame())
    if len(dq_df) > 0:
        lines.append(f"\n## Data Quality ({len(dq_df)} market-periods)\n")
        dq_show = [c for c in ["market", "period", "n_instruments", "fundamentals_pti_valid_pct_equity", "trailing_6m_return_coverage_pct", "news_items_total"] if c in dq_df.columns]
        lines.append(_df_to_md(dq_df[dq_show]))

    # ── 12. Sanity checks ──
    if sanity_result is not None:
        issues, passes = sanity_result
    else:
        issues, passes = run_sanity_checks(D, runs)
    lines.append(f"\n## Sanity Checks: {len(issues)} issues, {len(passes)} passes\n")
    for severity, title, desc in issues:
        tag = {"neg": "FAIL", "warn": "WARNING"}.get(severity, "INFO")
        lines.append(f"- **[{tag}]** {title}: {desc}")
    if not issues:
        lines.append("- All checks passed.")

    profile = "\n".join(lines)
    if len(profile) > 40_000:
        profile = profile[:40_000] + "\n\n[... DATA PROFILE TRUNCATED ...]"
    return profile


# Sanity checks + AI data profile walk every sheet; same inputs → same text. Recompute only when file or market filter changes.
_dqc_memo_key = (st.session_state.get("_loaded_file_id"), market_filter)
if st.session_state.get("_memo_dqc_key") != _dqc_memo_key:
    _dqc_iss, _dqc_pas = run_sanity_checks(D, runs)
    st.session_state["_memo_dqc_issues"] = _dqc_iss
    st.session_state["_memo_dqc_passes"] = _dqc_pas
    st.session_state["_memo_dqc_profile"] = build_data_profile(D, runs, sanity_result=(_dqc_iss, _dqc_pas))
    st.session_state["_memo_dqc_key"] = _dqc_memo_key
_cached_dq_issues = st.session_state["_memo_dqc_issues"]
_cached_dq_passes = st.session_state["_memo_dqc_passes"]
_cached_dq_profile = st.session_state["_memo_dqc_profile"]


with tab_quality:
    section_header("Data Quality & AI Assistant")

    dq_tab1, dq_tab2, dq_tab3, dq_tab4 = st.tabs(
        ["Sanity Checks", "Coverage & Metrics", "Stocks (audit & news)", "AI Assistant"]
    )

    # ────────────────────────────────────────
    # SANITY CHECKS (automated, rule-based)
    # ────────────────────────────────────────
    with dq_tab1:
        issues, passes = _cached_dq_issues, _cached_dq_passes

        # KPI summary
        n_issues = len(issues)
        n_warn = sum(1 for s, _, _ in issues if s == "warn")
        n_fail = sum(1 for s, _, _ in issues if s == "neg")
        n_pass = len(passes)

        kc1, kc2, kc3, kc4 = st.columns(4)
        with kc1:
            kpi_card("Total checks", str(n_issues + n_pass), ACCENT)
        with kc2:
            kpi_card("Passed", str(n_pass), GREEN)
        with kc3:
            kpi_card("Warnings", str(n_warn), AMBER)
        with kc4:
            kpi_card("Failures", str(n_fail), RED if n_fail > 0 else GREEN)

        soft_hr()

        if issues:
            section_header("Issues Found")
            for severity, title, desc in issues:
                insight_card(severity, title, desc)

        if passes:
            with st.expander(f"Passed checks ({n_pass})", expanded=False):
                for p in passes:
                    st.markdown(f"- {p}")

        # Sheet-level overview
        soft_hr()
        section_header("Data Sheets Overview")
        sheet_info = []
        for key, df in D.items():
            if isinstance(df, pd.DataFrame):
                n_rows = len(df)
                n_cols = len(df.columns)
                n_null = int(df.isna().sum().sum())
                null_pct = (n_null / (n_rows * n_cols) * 100) if n_rows * n_cols > 0 else 0
                sheet_info.append({
                    "Sheet": key,
                    "Rows": n_rows,
                    "Columns": n_cols,
                    "Missing cells": n_null,
                    "Missing %": f"{null_pct:.1f}%",
                    "Status": "Empty" if n_rows == 0 else ("Clean" if null_pct < 1 else "Has gaps"),
                })
        st.dataframe(pd.DataFrame(sheet_info), width="stretch", hide_index=True)

    # ────────────────────────────────────────
    # COVERAGE & METRICS (the original charts)
    # ────────────────────────────────────────
    with dq_tab2:
        if len(dq) > 0:
            cols = st.columns(4)
            with cols[0]:
                kpi_card("Market-periods", str(len(dq)), ACCENT)
            with cols[1]:
                avg_fund_coverage = dq["fundamentals_pti_valid_pct_equity"].mean() if "fundamentals_pti_valid_pct_equity" in dq.columns else np.nan
                kpi_card("Avg fundamentals coverage", fmtp(avg_fund_coverage), GREEN if pd.notna(avg_fund_coverage) and avg_fund_coverage > 95 else AMBER)
            with cols[2]:
                avg_return_cov = dq["trailing_6m_return_coverage_pct"].mean() if "trailing_6m_return_coverage_pct" in dq.columns else np.nan
                kpi_card("Avg return coverage", fmtp(avg_return_cov), GREEN if pd.notna(avg_return_cov) and avg_return_cov > 95 else AMBER)
            with cols[3]:
                total_news = dq["news_items_total"].sum() if "news_items_total" in dq.columns else 0
                kpi_card("Total news items", f"{int(total_news):,}", CYAN)

            if "trailing_6m_return_coverage_pct" in dq.columns:
                c1, c2 = st.columns(2)
                with c1:
                    fig = go.Figure()
                    for mkt in sorted(dq["market"].unique()):
                        subset = dq[dq["market"] == mkt].sort_values("period")
                        fig.add_trace(go.Scatter(
                            x=subset["period"],
                            y=subset.get("fundamentals_pti_valid_pct_equity", pd.Series(dtype=float)),
                            name=MARKET_LABELS.get(mkt, mkt),
                            mode="lines+markers", line_shape=SCATTER_LINE_SHAPE,
                        ))
                    fig.add_hline(y=95, line_dash="dash", line_color=AMBER)
                    fig.update_layout(**PLOT_LAYOUT, title="Fundamentals coverage %", yaxis=dict(range=[80, 101]))
                    st.plotly_chart(fig, width="stretch")

                with c2:
                    fig = go.Figure()
                    for mkt in sorted(dq["market"].unique()):
                        subset = dq[dq["market"] == mkt].sort_values("period")
                        fig.add_trace(go.Bar(
                            x=subset["period"],
                            y=subset.get("news_items_total", pd.Series(dtype=float)),
                            name=MARKET_LABELS.get(mkt, mkt),
                        ))
                    fig.update_layout(**PLOT_LAYOUT, title="News items per market-period", barmode="group")
                    st.plotly_chart(fig, width="stretch")

            if "n_instruments" in dq.columns:
                fig = go.Figure()
                for mkt in sorted(dq["market"].unique()):
                    subset = dq[dq["market"] == mkt].sort_values("period")
                    fig.add_trace(go.Scatter(
                        x=subset["period"], y=subset["n_instruments"],
                        name=MARKET_LABELS.get(mkt, mkt), mode="lines+markers", line_shape=SCATTER_LINE_SHAPE,
                    ))
                fig.update_layout(**PLOT_LAYOUT, title="Number of instruments per market-period")
                st.plotly_chart(fig, width="stretch")

            st.markdown("#### Raw data quality table")
            show = ["market", "period", "n_instruments", "n_equities", "fundamentals_pti_valid_pct_equity",
                    "pe_coverage_pct_equity", "trailing_6m_return_coverage_pct", "news_items_total"]
            available = [c for c in show if c in dq.columns]
            tbl = dq[available].copy()
            tbl.rename(columns={
                "fundamentals_pti_valid_pct_equity": "Fund. Valid %",
                "pe_coverage_pct_equity": "P/E Coverage %",
                "trailing_6m_return_coverage_pct": "Return Coverage %",
                "news_items_total": "News Items",
            }, inplace=True)
            st.dataframe(tbl, width="stretch", hide_index=True)
        else:
            st.info("No data quality information found.")

    # ────────────────────────────────────────
    # STOCK-LEVEL AUDIT & NEWS (per holding)
    # ────────────────────────────────────────
    with dq_tab3:
        section_header("Portfolio stocks — performance & news inputs")
        st.caption(
            "Matches **Data audit** (trailing return, vol, drawdown, news counts, as-of dates) and **News** headlines "
            "to tickers in **Portfolio runs** (long/holding rows) for the market and period you pick."
        )
        audit = D.get("data_audit", pd.DataFrame())
        news_df = D.get("news", pd.DataFrame())
        if len(audit) == 0 and len(news_df) == 0:
            st.info("This package has no **Data audit** or **News** sheet — export a workbook that includes those tabs.")
        elif len(runs_long) == 0 or "holding_ticker" not in runs_long.columns:
            st.info(
                "No **holding-level** rows in session (needs long-format **Portfolio runs** or a **Portfolio holdings** sheet). "
                "Stock-level audit cannot be aligned to tickers."
            )
        else:
            _mopts = sorted(runs_long["market"].dropna().unique().tolist()) if "market" in runs_long.columns else []
            _popts = sorted({str(x).strip() for x in runs_long["period"].dropna().unique()}) if "period" in runs_long.columns else []
            if not _mopts or not _popts:
                st.warning("Runs long data is missing market or period.")
            else:
                c_f1, c_f2, c_f3 = st.columns([1, 1, 1.4])
                with c_f1:
                    sel_m_stock = st.selectbox(
                        "Market",
                        _mopts,
                        format_func=lambda x: MARKET_LABELS.get(x, x),
                        key="dq_stock_mkt",
                    )
                with c_f2:
                    sel_p_stock = st.selectbox("Period", _popts, key="dq_stock_per")
                with c_f3:
                    _traj_opts = ["All trajectories (union of tickers)"]
                    if "trajectory_id" in runs_long.columns:
                        _sub = runs_long[
                            (runs_long["market"].map(_canonical_market_value) == _canonical_market_value(sel_m_stock))
                            & (runs_long["period"].astype(str).str.strip() == str(sel_p_stock).strip())
                        ]
                        _ids = sorted(_sub["trajectory_id"].dropna().astype(str).unique().tolist())
                        _traj_opts = _traj_opts + _ids
                    traj_pick = st.selectbox("Portfolio / trajectory", _traj_opts, key="dq_stock_traj")

                _tid = None if traj_pick == "All trajectories (union of tickers)" else traj_pick
                ad_sub, nw_sub, tickers = _audit_and_news_for_portfolio_slice(
                    audit, news_df, runs_long, sel_m_stock, sel_p_stock, trajectory_id=_tid,
                )
                if not tickers:
                    st.warning("No holdings found for this market × period (and trajectory filter).")
                else:
                    st.caption(f"**{len(tickers)}** tickers in scope · audit rows: **{len(ad_sub)}** · news rows: **{len(nw_sub)}**")
                    if len(ad_sub) > 0:
                        _disp = ad_sub.copy()
                        for _c in ("trailing_return_6m", "trailing_vol_6m", "trailing_max_drawdown_6m", "dividend_yield"):
                            if _c in _disp.columns:
                                _disp[_c] = pd.to_numeric(_disp[_c], errors="coerce")
                        _show_cols = [
                            c for c in (
                                "ticker", "name", "sector", "decision_date", "asof_cutoff_date",
                                "trailing_return_6m", "trailing_vol_6m", "trailing_max_drawdown_6m",
                                "dividend_yield", "news_count", "fundamentals_pti_valid", "data_basis",
                            )
                            if c in _disp.columns
                        ]
                        st.markdown("##### Audit metrics (as of decision)")
                        st.dataframe(
                            _disp[_show_cols].sort_values("ticker") if _show_cols else _disp,
                            width="stretch",
                            hide_index=True,
                            height=min(420, 60 + 28 * len(_disp)),
                        )
                    else:
                        st.warning(
                            "No **Data audit** rows matched these tickers. "
                            "Check that audit `ticker` / `market` / `period` align with **Portfolio runs**."
                        )

                    if len(nw_sub) > 0:
                        st.markdown("##### News used in the pipeline (pre-cutoff)")
                        nw_show = nw_sub.copy()
                        _nc = [c for c in ("published_at", "ticker", "source", "title", "url", "published_after_cutoff") if c in nw_show.columns]
                        st.dataframe(
                            nw_show[_nc].sort_values(["ticker", "published_at"] if "published_at" in nw_show.columns else ["ticker"]),
                            width="stretch",
                            hide_index=True,
                            height=min(480, 80 + 22 * min(len(nw_show), 120)),
                        )
                    elif len(news_df) > 0:
                        st.caption("No news rows matched this slice (check tickers / period).")

                    if len(ad_sub) > 0 and "trailing_return_6m" in ad_sub.columns:
                        _chart = ad_sub.copy()
                        _chart["tr_ret_pct"] = pd.to_numeric(_chart["trailing_return_6m"], errors="coerce") * 100.0
                        fig_st = go.Figure(go.Bar(
                            x=_chart["ticker"].astype(str),
                            y=_chart["tr_ret_pct"],
                            marker_color=CYAN,
                            text=[f"{v:.1f}%" if pd.notna(v) else "" for v in _chart["tr_ret_pct"]],
                            textposition="outside",
                        ))
                        fig_st.update_layout(
                            **PLOT_LAYOUT,
                            title="Trailing 6m return (%) — stocks in portfolio",
                            yaxis_title="Return %",
                            height=max(320, 40 + 18 * len(_chart)),
                        )
                        _apply_grid(fig_st)
                        st.plotly_chart(fig_st, width="stretch", key="dq_stock_tr6m")

    # ────────────────────────────────────────
    # AI ASSISTANT (chat with the data)
    # ────────────────────────────────────────
    with dq_tab4:
        section_header("AI Data Quality Assistant")
        st.caption("Ask questions about your data — the AI sees all sheets, statistics, and sanity check results.")

        _ai_enabled = bool(openai_key)
        if not _ai_enabled:
            st.warning("Enter your OpenAI API key in the sidebar to use the AI assistant.")

        if "dq_chat_history" not in st.session_state:
            st.session_state["dq_chat_history"] = []

        data_profile = _cached_dq_profile

        SYSTEM_PROMPT = f"""You are a senior quantitative analyst reviewing an empirical study on AI-based portfolio construction for retail investors. You have the full evaluation dataset including GPT reasoning text.

## Your approach

1. **Identify relevant data first.** Before answering, determine which numbers from the data profile (or the injected context block at the end of the user's message) are directly relevant.
2. **Cite specific numbers.** Every claim MUST reference a concrete value from the data. Format: "Advanced Sharpe 0.82 (n=45) vs Retail 0.54 (n=45)". If you cannot find data to support a claim, say "I don't have data for this" — never guess.
3. **Include sample sizes.** Always report n=X alongside means/percentages so the reader can judge reliability.
4. **Flag uncertainty.** If n < 10 for any statistic, explicitly note: "⚠ small sample (n=X), interpret with caution."
5. **Show your work.** For comparisons and derived numbers, briefly show the calculation or logic.

## Response structure (for analytical questions)

Use this structure:
1. **Direct answer** — one-sentence headline finding
2. **Evidence** — bullet points with specific numbers, identifiers, and comparisons
3. **Caveats** — sample size limitations, data gaps, assumptions
4. **Thesis implication** — what this means for the research conclusion

For simple factual lookups, just answer directly.

## Severity ratings

When flagging issues: **CRITICAL** (invalidates results), **WARNING** (needs attention), **INFO** (minor note).

## Dynamic context

When the user asks about a specific topic (market, ticker, prompt type, post-loss, reasoning), the system injects the relevant raw data rows in a `[RELEVANT DATA FOR THIS QUESTION]` block at the end of the user's message. Use this data for precise answers — it contains the actual rows, not just summaries.

## Follow-up questions

At the END of every response, suggest exactly 3 follow-up questions. Format:
[FOLLOW_UP_1] Specific question referencing data points from your answer
[FOLLOW_UP_2] A deeper-dive or cross-cutting angle
[FOLLOW_UP_3] A validation or sanity-check question

## Data profile

{data_profile}"""

        import re as _re

        def _split_followups(text):
            """Split AI response into main body and follow-up questions."""
            pattern = r'\[FOLLOW_UP_\d+\]\s*'
            parts = _re.split(pattern, text)
            body = parts[0].rstrip()
            followups = [p.strip() for p in parts[1:] if p.strip()]
            return body, followups

        def _truncate_btn(text, max_len=55):
            return (text[:max_len].rstrip() + "\u2026") if len(text) > max_len else text

        def _chat_to_markdown(history):
            lines = ["# AI Data Quality Assistant \u2014 Chat Export\n"]
            for msg in history:
                if msg["content"].startswith("Error calling OpenAI:"):
                    continue
                role = "You" if msg["role"] == "user" else "Assistant"
                body = msg["content"]
                if msg["role"] == "assistant":
                    body, _ = _split_followups(body)
                lines.append(f"### {role}\n\n{body}\n\n---\n")
            return "\n".join(lines)

        def _strip_followups_from_content(content):
            """Remove follow-up markers from assistant messages to save tokens."""
            body, _ = _split_followups(content)
            return body

        def _trim_messages_for_api(history, sys_prompt, max_chars=100_000):
            """Build the messages list for the API, trimming old turns to fit context.

            - Always keeps system prompt and last user message intact.
            - Strips follow-up suggestions from all historical assistant messages.
            - Keeps last 4 messages in full; summarises older ones.
            """
            msgs = [{"role": "system", "content": sys_prompt}]

            cleaned = []
            for m in history:
                c = m["content"]
                if m["role"] == "assistant" and not c.startswith("Error"):
                    c = _strip_followups_from_content(c)
                cleaned.append({"role": m["role"], "content": c})

            total = len(sys_prompt) + sum(len(m["content"]) for m in cleaned)
            if total <= max_chars:
                msgs.extend(cleaned)
                return msgs

            keep_n = 4
            old = cleaned[:-keep_n] if len(cleaned) > keep_n else []
            recent = cleaned[-keep_n:] if len(cleaned) > keep_n else cleaned

            if old:
                parts = []
                for m in old:
                    tag = "Q" if m["role"] == "user" else "A"
                    first_line = m["content"].split("\n")[0][:200]
                    parts.append(f"[{tag}: {first_line}]")
                msgs.append({"role": "user", "content": "[Earlier conversation summary]\n" + " | ".join(parts)})

            msgs.extend(recent)
            return msgs

        # ── Chat header with controls ──
        _hist = st.session_state["dq_chat_history"]
        _n_msgs = len(_hist)
        _has_conversation = _n_msgs > 0

        if _has_conversation:
            _hdr = st.columns([5, 1, 1, 1])
            with _hdr[0]:
                _n_user = sum(1 for m in _hist if m["role"] == "user")
                st.markdown(
                    f'<span style="color:#5E7082;font-size:11px;">'
                    f'{_n_user} question{"s" if _n_user != 1 else ""} &middot; '
                    f'Model: <strong style="color:{ACCENT}">{ai_model}</strong></span>',
                    unsafe_allow_html=True,
                )
            with _hdr[1]:
                if st.button("\u21bb New topic", key="dq_new_topic", help="Show quick-start prompts"):
                    st.session_state["dq_show_quickstart"] = True
                    st.rerun()
            with _hdr[2]:
                st.download_button(
                    "\u2913 Export",
                    data=_chat_to_markdown(_hist),
                    file_name="ai_chat_export.md",
                    mime="text/markdown",
                    key="dq_export_chat",
                )
            with _hdr[3]:
                if st.button("\u2715 Clear", key="dq_clear_chat", help="Delete all messages"):
                    st.session_state["dq_chat_history"] = []
                    st.session_state.pop("dq_show_quickstart", None)
                    st.rerun()

        # ── Quick-start buttons (hidden once conversation started) ──
        _show_quickstart = not _has_conversation or st.session_state.get("dq_show_quickstart", False)
        if _show_quickstart:
            st.markdown(
                '<p style="font-size:11px;color:#5E7082;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;margin-bottom:8px;margin-top:12px;">Quick start</p>',
                unsafe_allow_html=True,
            )
            sug_row1 = st.columns(3)
            with sug_row1[0]:
                if st.button("Full data quality audit", key="dq_suggest_1"):
                    st.session_state["dq_chat_input"] = "Run a comprehensive data quality audit. Check all numbers for consistency, flag any anomalies, and rate the overall data quality for thesis use. Reference specific run IDs and market/periods so I can find them in the reference panel."
                    st.session_state.pop("dq_show_quickstart", None)
                    st.rerun()
            with sug_row1[1]:
                if st.button("Check statistical validity", key="dq_suggest_2"):
                    st.session_state["dq_chat_input"] = "Review all statistical tests. Are sample sizes adequate? Are there any tests where the results seem suspicious or where assumptions might be violated?"
                    st.session_state.pop("dq_show_quickstart", None)
                    st.rerun()
            with sug_row1[2]:
                if st.button("Summarize key findings", key="dq_suggest_3"):
                    st.session_state["dq_chat_input"] = "Summarize the key findings from this evaluation. Which strategies perform best? Is the evidence strong enough for thesis conclusions?"
                    st.session_state.pop("dq_show_quickstart", None)
                    st.rerun()

            sug_row2 = st.columns(3)
            with sug_row2[0]:
                if st.button("Analyze GPT reasoning", key="dq_suggest_4"):
                    st.session_state["dq_chat_input"] = (
                        "Analyze the GPT's portfolio decision reasoning across all available runs. Specifically:\n"
                        "1. Is the reasoning coherent and specific, or generic and vague?\n"
                        "2. Does the stated reasoning align with actual portfolio outcomes (returns, risk)?\n"
                        "3. Are there differences in reasoning quality between retail and advanced prompts?\n"
                        "4. Does GPT show any systematic biases in its reasoning (recency, sector, home bias)?\n"
                        "5. For the worst-performing portfolios, was there a reasoning failure you can identify?\n"
                        "Reference specific run IDs so I can check the reference panel."
                    )
                    st.session_state.pop("dq_show_quickstart", None)
                    st.rerun()
            with sug_row2[1]:
                if st.button("Analyze post-loss behavior", key="dq_suggest_5"):
                    st.session_state["dq_chat_input"] = (
                        "Deep-dive into GPT's behavior after loss periods. Analyze:\n"
                        "1. What is the recovery rate after a loss? How does it compare between retail and advanced prompts?\n"
                        "2. Does GPT change its portfolio concentration (HHI) after losses, or stay the course?\n"
                        "3. Is turnover higher after losses (panic rebalancing) or similar to normal periods?\n"
                        "4. Look at the GPT reasoning during loss periods AND the reasoning right after \u2014 does the model acknowledge the loss? Does it adapt its strategy?\n"
                        "5. Are there cases where GPT doubled down after a loss and it worked, vs cases where it failed?\n"
                        "6. Overall verdict: Does GPT handle adversity well as a portfolio manager?\n"
                        "Reference specific run IDs and periods so I can check them in the reference panel."
                    )
                    st.session_state.pop("dq_show_quickstart", None)
                    st.rerun()
            with sug_row2[2]:
                if st.button("Compare prompt types", key="dq_suggest_6"):
                    st.session_state["dq_chat_input"] = (
                        "Compare retail vs advanced prompting across all dimensions:\n"
                        "1. Performance (Sharpe, returns, beat rates)\n"
                        "2. Risk management (drawdowns, HHI, post-loss recovery)\n"
                        "3. Reasoning quality (specificity, coherence, bias)\n"
                        "4. Which prompt type would you recommend for a retail investor and why?"
                    )
                    st.session_state.pop("dq_show_quickstart", None)
                    st.rerun()

        # ── Chat area ──
        for i, msg in enumerate(_hist):
            with st.chat_message(msg["role"]):
                if msg["role"] == "assistant":
                    if msg["content"].startswith("Error calling OpenAI:"):
                        st.error(msg["content"])
                    else:
                        body, _ = _split_followups(msg["content"])
                        st.markdown(body)
                        _mdl = msg.get("model", "")
                        if _mdl:
                            st.markdown(
                                f'<span style="display:inline-block;color:#5E7082;font-size:10px;'
                                f'background:#141A22;padding:2px 8px;border-radius:4px;'
                                f'border:1px solid #1E2A3A;margin-top:4px;">{_mdl}</span>',
                                unsafe_allow_html=True,
                            )
                else:
                    st.markdown(msg["content"])

        # ── Follow-up pill buttons ──
        if _hist and _hist[-1]["role"] == "assistant" and not _hist[-1]["content"].startswith("Error"):
            _, followups = _split_followups(_hist[-1]["content"])
            if followups:
                st.markdown(
                    '<p style="color:#5E7082;font-size:11px;margin-bottom:6px;margin-top:16px;">Suggested follow-ups</p>',
                    unsafe_allow_html=True,
                )
                _fu_cols = st.columns(min(len(followups), 3))
                for j, fq in enumerate(followups[:3]):
                    with _fu_cols[j]:
                        if st.button(
                            _truncate_btn(fq),
                            key=f"followup_{_n_msgs}_{j}",
                            help=fq if len(fq) > 55 else None,
                        ):
                            st.session_state["dq_chat_input"] = fq
                            st.session_state.pop("dq_show_quickstart", None)
                            st.rerun()

        # ── Retry on error ──
        if _hist and _hist[-1]["role"] == "assistant" and _hist[-1]["content"].startswith("Error calling OpenAI:"):
            if st.button("\u21bb Retry last question", key="dq_retry"):
                st.session_state["dq_chat_history"].pop()
                if st.session_state["dq_chat_history"] and st.session_state["dq_chat_history"][-1]["role"] == "user":
                    _retry_q = st.session_state["dq_chat_history"].pop()["content"]
                    st.session_state["dq_chat_input"] = _retry_q
                st.rerun()

        prefill = st.session_state.pop("dq_chat_input", None)
        user_input = st.chat_input("Ask about your data...", key="dq_chat")

        query = prefill or user_input

        if query and _hist and _hist[-1].get("role") == "user" and _hist[-1].get("content") == query:
            query = None

        if query and _ai_enabled:
            st.session_state["dq_chat_history"].append({"role": "user", "content": query})
            st.session_state.pop("dq_show_quickstart", None)
            with st.chat_message("user"):
                st.markdown(query)

            with st.chat_message("assistant"):
                try:
                    from openai import OpenAI
                    client = OpenAI(api_key=openai_key)

                    _query_ctx = _build_query_context(query, D, runs)
                    if _query_ctx:
                        _augmented_history = list(st.session_state["dq_chat_history"])
                        _augmented_history[-1] = {
                            "role": "user",
                            "content": query + _query_ctx,
                        }
                    else:
                        _augmented_history = st.session_state["dq_chat_history"]

                    messages = _trim_messages_for_api(_augmented_history, SYSTEM_PROMPT)

                    _old_api_models = {"gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"}
                    _temp_models = _old_api_models | {"gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"}
                    _supports_stream = ai_model not in {"o3", "o3-mini", "o4-mini"}
                    _api_kwargs = dict(model=ai_model, messages=messages)
                    if ai_model in _old_api_models:
                        _api_kwargs.update(temperature=0.15, max_tokens=8000)
                    elif ai_model in _temp_models:
                        _api_kwargs.update(temperature=0.15, max_completion_tokens=8000)
                    else:
                        _api_kwargs.update(max_completion_tokens=8000)

                    if _supports_stream:
                        _api_kwargs["stream"] = True
                        stream = client.chat.completions.create(**_api_kwargs)
                        _full_reply = ""
                        _ph = st.empty()
                        for chunk in stream:
                            if chunk.choices and chunk.choices[0].delta.content:
                                _full_reply += chunk.choices[0].delta.content
                                _body_so_far, _ = _split_followups(_full_reply)
                                _ph.markdown(_body_so_far + " \u258c")
                        _body_final, _ = _split_followups(_full_reply)
                        _ph.markdown(_body_final)
                        st.markdown(
                            f'<span style="display:inline-block;color:#5E7082;font-size:10px;'
                            f'background:#141A22;padding:2px 8px;border-radius:4px;'
                            f'border:1px solid #1E2A3A;margin-top:4px;">{ai_model}</span>',
                            unsafe_allow_html=True,
                        )
                        st.session_state["dq_chat_history"].append(
                            {"role": "assistant", "content": _full_reply, "model": ai_model}
                        )
                        st.rerun()
                    else:
                        with st.spinner("Analyzing data..."):
                            response = client.chat.completions.create(**_api_kwargs)
                            reply = response.choices[0].message.content
                            body, _ = _split_followups(reply)
                            st.markdown(body)
                            st.markdown(
                                f'<span style="display:inline-block;color:#5E7082;font-size:10px;'
                                f'background:#141A22;padding:2px 8px;border-radius:4px;'
                                f'border:1px solid #1E2A3A;margin-top:4px;">{ai_model}</span>',
                                unsafe_allow_html=True,
                            )
                            st.session_state["dq_chat_history"].append(
                                {"role": "assistant", "content": reply, "model": ai_model}
                            )
                            st.rerun()
                except Exception as e:
                    _err_str = str(e).lower()
                    _is_ctx_err = any(k in _err_str for k in [
                        "context_length", "maximum context", "too many tokens",
                        "max_tokens", "context window", "token limit",
                    ])
                    if _is_ctx_err and len(st.session_state["dq_chat_history"]) > 2:
                        _retry_q = st.session_state["dq_chat_history"].pop()["content"]
                        st.session_state["dq_chat_history"] = st.session_state["dq_chat_history"][-4:]
                        st.session_state["dq_chat_input"] = _retry_q
                        st.info("Context window exceeded \u2014 trimmed older messages. Retrying\u2026")
                        st.rerun()
                    err_msg = f"Error calling OpenAI: {e}"
                    st.error(err_msg)
                    st.session_state["dq_chat_history"].append(
                        {"role": "assistant", "content": err_msg, "model": ai_model}
                    )
                    st.rerun()
        elif query and not _ai_enabled:
            st.warning("Enter your OpenAI API key in the sidebar first.")

        # ── REFERENCE DATA PANEL ──
        soft_hr()
        section_header("Reference Data")
        st.caption("Expand any section to inspect the actual data rows behind the AI's findings.")

        if len(runs) > 0:
            id_col = _preferred_run_identifier_column(runs.columns)
            ret_col = next((c for c in ["net_return", "period_return_net", "period_return"] if c in runs.columns), None)
            show_cols_base = [c for c in [id_col, "market", "period", "prompt_type", "model",
                              "sharpe_ratio", ret_col, "hhi", "effective_n_holdings", "n_holdings"] if c and c in runs.columns]
            reasoning_cols = [c for c in runs.columns if any(
                kw in c.lower() for kw in ["reason", "rational", "explanation", "response", "gpt_response",
                                             "justification", "analysis", "narrative", "thinking", "decision",
                                             "rationale", "summary", "reasoning_summary"]
            )]

            # Extreme Sharpe ratios
            if "sharpe_ratio" in runs.columns:
                extreme = runs[(runs["sharpe_ratio"] > 10) | (runs["sharpe_ratio"] < -10)]
                if len(extreme) > 0:
                    with st.expander(f"Extreme Sharpe ratios ({len(extreme)} runs)", expanded=False):
                        st.dataframe(extreme[show_cols_base].sort_values("sharpe_ratio", ascending=False), width="stretch", hide_index=True)

            # Duplicate runs
            if id_col and "period" in runs.columns and "market" in runs.columns:
                dup_mask = runs.duplicated(subset=[id_col, "period", "market"], keep=False)
                dups = runs[dup_mask].copy()
                if len(dups) > 0:
                    dup_groups = dups.groupby([id_col, "period", "market"]).size().reset_index(name="count")
                    dup_groups = dup_groups.sort_values("count", ascending=False)
                    n_groups = len(dup_groups)
                    with st.expander(f"Duplicate runs — {n_groups} duplicate groups, {len(dups)} total rows", expanded=False):
                        st.markdown(f"**{n_groups} unique (run, period, market) combinations appear more than once.** "
                                    f"Total duplicate rows: **{len(dups)}**")
                        st.markdown("##### Duplicate groups (which run × period × market is duplicated)")
                        dup_groups.rename(columns={id_col: "Run ID", "period": "Period", "market": "Market", "count": "Times Appears"}, inplace=True)
                        st.dataframe(dup_groups, width="stretch", hide_index=True)

                        st.markdown("##### All duplicate rows (full detail)")
                        dups_sorted = dups[show_cols_base].sort_values([id_col, "period", "market"])
                        dups_sorted["_dup_group"] = dups[id_col].astype(str) + " | " + dups["period"].astype(str) + " | " + dups["market"].astype(str)
                        st.dataframe(dups_sorted, width="stretch", hide_index=True)

            def _show_reasoning_table(df, show_cols, reasoning_cols, sort_col=None, sort_asc=True):
                """Show a data table, and if reasoning columns exist, show them as readable text below."""
                display_df = df[show_cols].copy() if sort_col is None else df[show_cols].sort_values(sort_col, ascending=sort_asc).copy()
                st.dataframe(display_df, width="stretch", hide_index=True)
                if reasoning_cols:
                    rc = reasoning_cols[0]
                    if rc in df.columns:
                        rows_with_text = df[df[rc].notna() & (df[rc].astype(str).str.len() > 10)]
                        if len(rows_with_text) > 0:
                            st.markdown(f"**{rc}** for these runs:")
                            sorted_rows = rows_with_text.sort_values(sort_col, ascending=sort_asc) if sort_col and sort_col in rows_with_text.columns else rows_with_text
                            for _, r in sorted_rows.head(10).iterrows():
                                run_label = r.get(id_col, "?") if id_col else "?"
                                mkt = r.get("market", "")
                                per = r.get("period", "")
                                text = str(r[rc])[:500]
                                st.markdown(f"""<div style="background:#141A22; border:1px solid #1E2A3A; border-radius:6px; padding:10px 14px; margin-bottom:8px;">
<span style="color:{ACCENT}; font-weight:700; font-size:12px;">{run_label}</span>
<span style="color:#5E7082; font-size:11px;"> | {mkt}/{per}</span><br>
<span style="color:#A0AEBB; font-size:12px; line-height:1.5;">{text}</span>
</div>""", unsafe_allow_html=True)

            # Runs with negative returns (loss periods)
            if ret_col:
                loss_mask = runs[ret_col] < 0
                loss_df = runs[loss_mask].copy()
                if len(loss_df) > 0:
                    loss_df["return_pct"] = loss_df[ret_col].apply(
                        lambda v: f"{v*100:.1f}%" if pd.notna(v) and abs(v) < 5 else (f"{v:.1f}%" if pd.notna(v) else "—")
                    )
                    loss_show = show_cols_base + ["return_pct"]
                    loss_show = [c for c in loss_show if c in loss_df.columns]
                    with st.expander(f"Loss periods — negative return ({len(loss_df)} runs)", expanded=False):
                        _show_reasoning_table(loss_df, loss_show, reasoning_cols, sort_col=ret_col, sort_asc=True)

            # After-loss runs (run that follows a loss period)
            if ret_col and id_col and "period" in runs.columns:
                has_prompt = "prompt_type" in runs.columns
                gpt_only = runs[runs["prompt_type"].isin(["retail", "advanced"])].copy() if has_prompt else runs.copy()
                after_loss_indices = []
                for traj in gpt_only[id_col].dropna().unique():
                    traj_data = gpt_only[gpt_only[id_col] == traj].sort_values("period")
                    prev_ret = None
                    for idx, row in traj_data.iterrows():
                        cur_ret = row.get(ret_col, np.nan)
                        if prev_ret is not None and pd.notna(prev_ret) and prev_ret < 0:
                            after_loss_indices.append(idx)
                        prev_ret = cur_ret

                if after_loss_indices:
                    al_df = runs.loc[after_loss_indices].copy()
                    al_df["return_pct"] = al_df[ret_col].apply(
                        lambda v: f"{v*100:.1f}%" if pd.notna(v) and abs(v) < 5 else (f"{v:.1f}%" if pd.notna(v) else "—")
                    )
                    al_df["recovered"] = al_df[ret_col].apply(lambda v: "Yes" if pd.notna(v) and v > 0 else "No")
                    al_show = show_cols_base + ["return_pct", "recovered"]
                    al_show = [c for c in al_show if c in al_df.columns]
                    with st.expander(f"After-loss runs — period following a loss ({len(al_df)} runs)", expanded=False):
                        recovery_rate = (al_df[ret_col] > 0).sum() / len(al_df) * 100 if len(al_df) > 0 else 0
                        st.markdown(f"**Recovery rate:** {recovery_rate:.0f}% of runs recovered to positive returns after a loss")
                        _show_reasoning_table(al_df, al_show, reasoning_cols, sort_col=ret_col, sort_asc=True)

            # Worst performers
            if "sharpe_ratio" in runs.columns:
                worst = runs.nsmallest(20, "sharpe_ratio")
                worst_show = [c for c in show_cols_base if c in worst.columns]
                with st.expander(f"Worst 20 runs by Sharpe ratio", expanded=False):
                    _show_reasoning_table(worst, worst_show, reasoning_cols, sort_col="sharpe_ratio", sort_asc=True)

            # Best performers
            if "sharpe_ratio" in runs.columns:
                best = runs.nlargest(20, "sharpe_ratio")
                best_show = [c for c in show_cols_base if c in best.columns]
                with st.expander(f"Best 20 runs by Sharpe ratio", expanded=False):
                    _show_reasoning_table(best, best_show, reasoning_cols, sort_col="sharpe_ratio", sort_asc=False)

        # Low coverage from data quality sheet
        if len(dq) > 0:
            for pct_col, label in [
                ("fundamentals_pti_valid_pct_equity", "Fundamentals coverage"),
                ("pe_coverage_pct_equity", "P/E coverage"),
                ("trailing_6m_return_coverage_pct", "Return coverage"),
            ]:
                if pct_col in dq.columns:
                    low = dq[dq[pct_col] < 90]
                    if len(low) > 0:
                        with st.expander(f"Low {label} < 90% ({len(low)} market-periods)", expanded=False):
                            show_dq = ["market", "period", pct_col, "n_instruments"]
                            show_dq = [c for c in show_dq if c in dq.columns]
                            st.dataframe(low[show_dq].sort_values(pct_col), width="stretch", hide_index=True)

        # Stats tests table
        if len(stats) > 0:
            with st.expander(f"All statistical tests ({len(stats)} tests)", expanded=False):
                st.dataframe(stats, width="stretch", hide_index=True)