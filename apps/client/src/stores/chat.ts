/**
 * chat store
 *
 * U8 范围：仅维护会话列表 + 当前会话 ID 状态，不实现具体增删改查/分页拉取。
 * - 后续 U9 在 store 之上实现：`loadConversations()` / `createConversation()` / `appendMessage()` 等。
 * - 当前会话 ID 切换是 U9 路由联动的关键。
 *
 * 类型来源：复用 `@xiaoyu/api-types` 的 `Conversation`，避免重复定义。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Conversation } from '@xiaoyu/api-types';

export const useChatStore = defineStore('chat', () => {
  const conversations = ref<Conversation[]>([]);
  const currentConversationId = ref<string | null>(null);

  function setCurrentConversationId(id: string | null) {
    currentConversationId.value = id;
  }

  return {
    conversations,
    currentConversationId,
    setCurrentConversationId,
  };
});

export default useChatStore;
