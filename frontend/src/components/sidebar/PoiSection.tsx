import { Button, Divider, Stack, Typography } from "@mui/material";
import AddLocationIcon from "@mui/icons-material/AddLocation";
import type { Poi } from "../../types/mission";

import ManeuverCard from "../ManeuverCard";

interface PoiSectionProps {
  pois: Poi[];
  onPoiChange: (index: number, updated: Poi) => void;
  onPoiRemove: (index: number) => void;
  onPoiActivatePlace: (index: number) => void;
  onActivatePolygonDraw: (index: number) => void;
  onPoiDragStart: (index: number) => void;
  onPoiDrop: (toIndex: number) => void;
  onAddPoi: () => void;
}

/** POIs & Maneuvers list with ManeuverCards and an Add POI button. */
export function PoiSection({
  pois,
  onPoiChange,
  onPoiRemove,
  onPoiActivatePlace,
  onActivatePolygonDraw,
  onPoiDragStart,
  onPoiDrop,
  onAddPoi,
}: PoiSectionProps) {
  return (
    <>
      <Divider sx={{ my: 1 }} />
      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
        POIs &amp; Maneuvers
      </Typography>
      <Stack spacing={1} data-tutorial="pois">
        {pois.map((poi, i) => (
          <ManeuverCard
            key={poi.id}
            index={i}
            poi={poi}
            onChange={onPoiChange}
            onRemove={onPoiRemove}
            onActivatePlace={onPoiActivatePlace}
            onActivatePolygonDraw={onActivatePolygonDraw}
            onDragStart={onPoiDragStart}
            onDrop={onPoiDrop}
          />
        ))}
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddLocationIcon />}
          onClick={onAddPoi}
          sx={{ textTransform: "none" }}
        >
          Add POI
        </Button>
      </Stack>
    </>
  );
}
