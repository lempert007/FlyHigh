"""
Export planned waypoints as a KML file (Google Earth / DJI compatible).
"""

from __future__ import annotations

from xml.sax.saxutils import escape as _xml_escape


def render_kml(waypoints: list[dict]) -> str:
    """Convert a waypoint list to a KML string.

    Generates one Placemark per waypoint and a LineString for the route path.
    All altitudes are absolute MSL (altitudeMode=absolute).
    """
    placemarks = []
    for i, wp in enumerate(waypoints):
        name = _xml_escape(f"WP{i + 1} ({wp['action']})")
        placemarks.append(
            f'  <Placemark>'
            f'<name>{name}</name>'
            f'<styleUrl>#wp</styleUrl>'
            f'<Point><altitudeMode>absolute</altitudeMode>'
            f'<coordinates>{wp["lon"]},{wp["lat"]},{wp["alt_m"]}</coordinates>'
            f'</Point></Placemark>'
        )
    route_coords = " ".join(f'{wp["lon"]},{wp["lat"]},{wp["alt_m"]}' for wp in waypoints)
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2">',
        "<Document>",
        "  <name>FlyHigh Mission</name>",
        '  <Style id="wp">',
        "    <IconStyle><color>ff0000ff</color><scale>0.8</scale></IconStyle>",
        "  </Style>",
        *placemarks,
        "  <Placemark>",
        "    <name>Route</name>",
        "    <LineString>",
        "      <altitudeMode>absolute</altitudeMode>",
        f"      <coordinates>{route_coords}</coordinates>",
        "    </LineString>",
        "  </Placemark>",
        "</Document>",
        "</kml>",
    ]
    return "\n".join(lines)
