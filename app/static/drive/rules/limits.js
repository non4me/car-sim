// Evaluate what the car is doing against the map: current segment + speed limit,
// over-limit, off-surface, and out-of-bounds (map edge). Pure, testable.
export function evalRules(map, car) {
  const b = map.meta.bounds;
  const M = 25; // metres of slack past the baked bounds before "no road"
  const inBounds = b && car.x > b.minx - M && car.x < b.maxx + M &&
                        car.y > b.miny - M && car.y < b.maxy + M;
  const { edge, dist } = map.nearestEdge(car.x, car.y);
  const onSurface = edge ? dist <= edge.width / 2 + 1.2 : false;
  const kmh = Math.round(Math.abs(car.v) * 3.6);
  const limit = edge ? edge.maxspeed : null;
  const over = limit != null && onSurface && kmh > limit + 3;
  return {
    limit, over, onSurface,
    boundary: !inBounds,
    offRoad: inBounds && !onSurface,
    street: edge ? (edge.name || "") : "",
    width: edge ? edge.width : 7,
    kmh,
  };
}
