import { useEffect, useState } from "react";
import { since } from "../../lib/format.ts";

export function UpdatedAt({ stamp }: { stamp: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  const date = new Date(stamp);
  return (
    <time id="updated-at" dateTime={date.toISOString()} title={date.toLocaleString("ko-KR")}>
      {since(stamp / 1000)} 갱신
    </time>
  );
}
