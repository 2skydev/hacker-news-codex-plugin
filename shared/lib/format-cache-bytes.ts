export function formatCacheBytes(bytes: number) {
  const [scale, unit] =
    bytes >= 1048576 ? [1048576, "MB"] : bytes >= 1024 ? [1024, "KB"] : [1, "B"];
  return `${(bytes / scale).toLocaleString("ko", { maximumFractionDigits: 1 })} ${unit}`;
}
