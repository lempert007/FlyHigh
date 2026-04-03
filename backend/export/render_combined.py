"""
Combine the Folium map, 3D terrain chart, and AGL profile into a single
tabbed HTML page.  Each panel is embedded as a srcdoc iframe so the output
is fully self-contained and works when opened as a blob URL in Chrome.
"""

from __future__ import annotations

from export.html_utils import srcdoc_escape


def render_combined_html(
    map_html: str,
    chart_3d_html: str,
    profile_html: str,
    smart_route_diff_html: str | None = None,
) -> str:
    """Combine three (or four) HTML strings into one tabbed page.

    Each panel is embedded as an iframe so the result is a single,
    fully self-contained file.  When ``smart_route_diff_html`` is provided a
    fourth "Smart Route Diff" tab is appended.

    Returns:
        Complete HTML string.
    """

    # All tabs use srcdoc — data: URI iframes are blocked by Chrome when the
    # parent page is opened as a blob URL (URL.createObjectURL).
    tabs = [
        ("map", "2D Map", srcdoc_escape(map_html)),
        ("terrain", "3D Terrain", srcdoc_escape(chart_3d_html)),
        ("profile", "Altitude Profile", srcdoc_escape(profile_html)),
    ]
    if smart_route_diff_html is not None:
        tabs.append(("smartroute", "Smart Route Diff", srcdoc_escape(smart_route_diff_html)))

    buttons = "\n  ".join(
        f'<button class="tab{" active" if i == 0 else ""}" data-target="{tid}">{label}</button>'
        for i, (tid, label, _) in enumerate(tabs)
    )

    def iframe_tag(i, tid, srcdoc_data):
        display = "block" if i == 0 else "none"
        style = f'style="display:{display};width:100%;height:calc(100vh - 52px);border:none;"'
        return f'<iframe id="{tid}" srcdoc="{srcdoc_data}" {style}></iframe>'

    iframes = "\n".join(
        iframe_tag(i, tid, srcdoc_data) for i, (tid, _, srcdoc_data) in enumerate(tabs)
    )

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>FlyHigh Mission Report</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#0d1117;font-family:Inter,system-ui,sans-serif;height:100vh;overflow:hidden}}
.tabbar{{display:flex;gap:6px;padding:8px 14px;background:#161b22;
  border-bottom:1px solid #30363d;height:52px;align-items:center}}
h1{{color:#1E90FF;font-size:15px;font-weight:700;margin-right:14px;letter-spacing:.5px}}
.tab{{background:transparent;color:#8b949e;border:1px solid #30363d;
  padding:6px 20px;border-radius:6px;cursor:pointer;font-size:13px;
  transition:all .15s}}
.tab:hover{{color:#c9d1d9;border-color:#58a6ff}}
.tab.active{{background:#1E90FF;color:#fff;border-color:#1E90FF;font-weight:600}}
</style>
</head>
<body>
<div class="tabbar">
  <h1>FlyHigh</h1>
  {buttons}
</div>
{iframes}
<script>
document.querySelectorAll('.tab').forEach(btn => {{
  btn.addEventListener('click', () => {{
    document.querySelectorAll('iframe').forEach(f => f.style.display = 'none');
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.getElementById(btn.dataset.target).style.display = 'block';
    btn.classList.add('active');
  }});
}});
</script>
</body>
</html>"""
