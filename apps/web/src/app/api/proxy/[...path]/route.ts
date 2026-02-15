import { proxyControlPlaneRequest } from "../../../../lib/server/control-plane-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const params = await ctx.params;
  return proxyControlPlaneRequest(request, params.path);
}

export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const params = await ctx.params;
  return proxyControlPlaneRequest(request, params.path);
}

export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const params = await ctx.params;
  return proxyControlPlaneRequest(request, params.path);
}

export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const params = await ctx.params;
  return proxyControlPlaneRequest(request, params.path);
}
