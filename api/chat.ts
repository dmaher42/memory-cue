/*
DEPRECATED ASSISTANT ENDPOINT
Use /api/assistant-chat
*/
import assistantChatHandler from './assistant-chat';

export default async function handler(req, res) {
  return assistantChatHandler(req, res);
}
