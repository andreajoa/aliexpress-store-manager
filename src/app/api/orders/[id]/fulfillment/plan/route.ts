import { NextResponse } from "next/server";

import { buildOrderFulfillmentPlan } from "@/lib/order-fulfillment-service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const plan = await buildOrderFulfillmentPlan(id);
  return NextResponse.json({ ok: plan.ready, plan }, { status: plan.ready ? 200 : 422 });
}
