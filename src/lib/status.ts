// 各種連携の接続状況
import { env } from "./env";
import { receptionSink, receptionSinkLabel } from "./estimates";
import { getKnowledge } from "./knowledge";
import { verifyOpenAI } from "./openai";
import { storageInfo } from "./store";
import type { IntegrationStatus } from "./types";

export async function getIntegrationStatus(baseUrl: string, check = false): Promise<IntegrationStatus> {
  const [knowledge, openaiCheck] = await Promise.all([
    getKnowledge(),
    check ? verifyOpenAI() : Promise.resolve<{ ok?: boolean; detail?: string }>({}),
  ]);
  const sink = receptionSink();
  return {
    openai: {
      configured: env.hasOpenAI,
      model: env.chatModel,
      answerModel: env.answerModel,
      answerContext: env.answerContext,
      realtimeModel: env.realtimeModel,
      realtimeVoice: env.realtimeVoice,
      realtimeSpeed: env.realtimeSpeed,
      ok: openaiCheck.ok,
      detail: openaiCheck.detail,
    },
    storage: storageInfo(),
    knowledge: {
      source: knowledge.source,
      label: knowledge.sourceLabel,
      entries: knowledge.entries.length,
      fetchedAt: knowledge.fetchedAt,
      warning: knowledge.warning,
    },
    reception: { sink, label: receptionSinkLabel(sink) },
    sheet: { configured: env.hasServiceAccount && env.knowledgeSheetId !== "", serviceAccount: env.googleServiceAccountEmail, sheetId: env.knowledgeSheetId },
    twilio: {
      configured: env.hasTwilio,
      number: env.twilioPhoneNumber,
      webhookUrl: `${baseUrl}/api/twilio/voice`,
    },
    line: {
      configured: env.hasLine,
      webhookUrl: `${baseUrl}/api/line/webhook`,
      addFriendUrl: env.lineAddFriendUrl,
    },
    admin: { protected: env.adminProtected },
  };
}
