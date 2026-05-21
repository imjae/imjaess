import { NextResponse } from "next/server";
import { z } from "zod";
import { effectiveAgentSettings } from "@/lib/config";
import { upsertAgentSetting } from "@/lib/db";
import { defaultModelForProvider, isValidModelForProvider, modelCatalog } from "@/lib/model-catalog";

export const dynamic = "force-dynamic";

const roleSchema = z.enum(["researcher", "implementer", "tester", "verifier"]);
const providerSchema = z.enum(["openai", "mock"]);

const settingsSchema = z.object({
  settings: z.array(
    z.object({
      role: roleSchema,
      provider: providerSchema,
      model: z.string().min(1)
    })
  )
});

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ settings: effectiveAgentSettings(), modelCatalog: modelCatalog() });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const body = settingsSchema.parse(await request.json());
  const settings = body.settings.map((setting) =>
    upsertAgentSetting({
      role: setting.role,
      provider: setting.provider,
      model: isValidModelForProvider(setting.provider, setting.model)
        ? setting.model
        : defaultModelForProvider(setting.provider)
    })
  );
  return NextResponse.json({ settings, modelCatalog: modelCatalog() });
}
