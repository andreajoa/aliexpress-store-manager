import { fetchFxRate } from "../src/lib/fx-rate.ts";

const quote = await fetchFxRate({ from: "CNY", to: "USD" });
console.log(JSON.stringify({ ok: true, quote }, null, 2));
