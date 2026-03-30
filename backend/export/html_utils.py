"""
Shared HTML helpers for export modules.
"""

from __future__ import annotations

import html as _html

_DARK_FULLSCREEN_CSS = (
    "<style>"
    "html,body{margin:0;padding:0;height:100%;background:#111;overflow:hidden;}"
    ".plotly-graph-div{height:100vh!important;width:100vw!important;}"
    "</style>"
)


def srcdoc_escape(content: str) -> str:
    """Escape a string for safe embedding as an HTML iframe srcdoc attribute."""
    return _html.escape(content, quote=True)


def inject_dark_fullscreen_css(html_str: str) -> str:
    """Inject CSS that makes a Plotly page fill the viewport on a dark background."""
    return html_str.replace("</head>", _DARK_FULLSCREEN_CSS + "</head>", 1)
