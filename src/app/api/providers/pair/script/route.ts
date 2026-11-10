import { NextRequest } from "next/server";
import { appOrigin, buildConnectScript } from "@/lib/providerPair";

/** The connect script, served as plain JavaScript. Public; contains no secrets. */
export async function GET(req: NextRequest) {
  return new Response(buildConnectScript(appOrigin(req)), {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
