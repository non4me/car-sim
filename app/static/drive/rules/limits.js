// Evaluate what the car is doing against the map: current segment + speed limit,
// over-limit, off-surface, and out-of-bounds (map edge). Pure, testable.
export function evalRules(map, car) {
  const b = map.meta.bounds;
  const M = 25; // metres of slack past the baked bounds before "no road"
  const inBounds = b && car.x > b.minx - M && car.x < b.maxx + M &&
                        car.y > b.miny - M && car.y < b.maxy + M;
  const ne = map.nearestEdge(car.x, car.y);
  const edge = ne.edge, dist = ne.dist;
  const onSurface = edge ? dist <= edge.width / 2 + 1.2 : false;
  const kmh = Math.round(Math.abs(car.v) * 3.6);
  const limit = edge ? edge.maxspeed : null;
  const over = limit != null && onSurface && kmh > limit + 3;

  // oncoming-lane / wrong-way (RHT, §). On a one-way street, geom = flow direction, so a
  // heading pointing against it is wrong-way. On a two-way road, being clearly on the LEFT of
  // your own travel direction means you've crossed the centre line into the oncoming lane.
  let oncoming = false;
  if (edge && onSurface) {
    const along = Math.cos(car.h) * ne.tx + Math.sin(car.h) * ne.ty;   // >0: travelling in geom dir
    if (edge.oneway) {
      oncoming = along < -0.35;                       // facing against the flow
    } else if (edge.width >= 5) {
      const cross = ne.tx * (car.y - ne.py) - ne.ty * (car.x - ne.px); // >0: left of geom tangent
      const leftOfTravel = (along >= 0 ? 1 : -1) * cross;
      oncoming = leftOfTravel > 0.8;                  // ≥0.8 m past centre into the oncoming half
    }
  }

  return {
    limit, over, onSurface, oncoming,
    boundary: !inBounds,
    offRoad: inBounds && !onSurface,
    street: edge ? (edge.name || "") : "",
    width: edge ? edge.width : 7,
    kmh,
  };
}
