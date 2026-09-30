export function keyboardBoardPositions(
  nodes: {
    id: string;
    selected?: boolean;
    type?: string;
    position: { x: number; y: number };
  }[],
  key: string,
  shift = false,
) {
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const direction = directions[key];
  if (!direction) return [];
  const step = shift ? 40 : 10;
  return nodes
    .filter((node) => node.selected && node.type === "research")
    .map((node) => ({
      id: node.id,
      x: Math.round(node.position.x / 10) * 10 + direction[0] * step,
      y: Math.round(node.position.y / 10) * 10 + direction[1] * step,
    }));
}
