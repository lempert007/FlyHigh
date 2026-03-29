"""
Combine the Folium map, 3D terrain chart, and AGL profile into a single
tabbed HTML page.  Each panel is embedded as a base64 data-URI iframe so
the output is fully self-contained.
"""

from __future__ import annotations

import base64

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

    def b64(html: str) -> str:
        return base64.b64encode(html.encode("utf-8")).decode("ascii")

    tabs = [
        # map uses srcdoc so Leaflet gets a proper origin and can load tiles/scripts
        ("map",     "2D Map",           None,                   srcdoc_escape(map_html)),
        ("terrain", "3D Terrain",       b64(chart_3d_html),     None),
        ("profile", "Altitude Profile", b64(profile_html),      None),
    ]
    if smart_route_diff_html is not None:
        # srcdoc (not data: URI) so nested iframes inside the diff page
        # get a proper browsing context — same reason the map uses srcdoc.
        tabs.append(("smartroute", "Smart Route Diff", None, srcdoc_escape(smart_route_diff_html)))

    buttons = "\n  ".join(
        f'<button class="tab{" active" if i == 0 else ""}" data-target="{tid}">{label}</button>'
        for i, (tid, label, _, __) in enumerate(tabs)
    )

    def iframe_tag(i, tid, b64_data, srcdoc_data):
        display = "block" if i == 0 else "none"
        style = f'style="display:{display};width:100%;height:calc(100vh - 52px);border:none;"'
        if srcdoc_data is not None:
            return f'<iframe id="{tid}" srcdoc="{srcdoc_data}" {style}></iframe>'
        return f'<iframe id="{tid}" src="data:text/html;base64,{b64_data}" {style}></iframe>'

    iframes = "\n".join(
        iframe_tag(i, tid, b64_data, srcdoc_data)
        for i, (tid, _, b64_data, srcdoc_data) in enumerate(tabs)
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
