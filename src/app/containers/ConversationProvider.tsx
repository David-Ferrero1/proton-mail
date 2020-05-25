import React, { useEffect, createContext, ReactNode, useContext } from 'react';
import { useInstance, useEventManager, useApi } from 'react-components';
import createCache from 'proton-shared/lib/helpers/cache';
import createLRU from 'proton-shared/lib/helpers/lru';
import { EVENT_ACTIONS } from 'proton-shared/lib/constants';

import { Event } from '../models/event';
import { Cache } from '../models/utils';
import { ConversationResult } from '../hooks/useConversation';
import { Api } from 'proton-shared/lib/interfaces';
import { getConversation } from 'proton-shared/lib/api/conversations';
import { parseLabelIDsInEvent } from '../helpers/elements';
import { useExpirationCheck } from '../hooks/useExpiration';
import { identity } from 'proton-shared/lib/helpers/function';
import { Conversation } from '../models/conversation';

export type ConversationCache = Cache<ConversationResult>;

/**
 * Conversation context containing the Conversation cache
 */
const ConversationContext = createContext<ConversationCache>(null as any);

/**
 * Hook returning the Conversation cache
 */
export const useConversationCache = () => useContext(ConversationContext);

/**
 * Event management logic for conversations
 */
const conversationListener = (cache: ConversationCache, api: Api) => {
    const reloadConversation = async (ID: string) => {
        const result = (await api(getConversation(ID))) as ConversationResult;
        cache.set(ID, result);
    };

    return ({ Conversations, Messages }: Event) => {
        if (!Array.isArray(Conversations)) {
            return;
        }

        for (const { ID, Action, Conversation } of Conversations) {
            // Ignore updates for non-fetched messages.
            if (!cache.has(ID)) {
                continue;
            }
            if (Action === EVENT_ACTIONS.DELETE) {
                cache.delete(ID);
            }
            if (Action === EVENT_ACTIONS.UPDATE_DRAFT || Action === EVENT_ACTIONS.UPDATE_FLAGS) {
                const currentValue = cache.get(ID) as ConversationResult;

                // Try to update the conversation from event data without reloading it
                try {
                    const updatedConversation: Conversation = parseLabelIDsInEvent(
                        currentValue.Conversation,
                        Conversation
                    );
                    const updatedMessages = currentValue.Messages || [];

                    Messages?.forEach(({ ID, Action, Message }) => {
                        const index = updatedMessages.findIndex((currentMessage) => currentMessage.ID === ID);
                        if (Action === EVENT_ACTIONS.DELETE && index !== -1) {
                            updatedMessages.splice(index, 1);
                        }
                        if (
                            Action === EVENT_ACTIONS.CREATE &&
                            Message.ConversationID === currentValue.Conversation.ID
                        ) {
                            updatedMessages.push(Message);
                        }
                        if (
                            (Action === EVENT_ACTIONS.UPDATE_DRAFT || Action === EVENT_ACTIONS.UPDATE_FLAGS) &&
                            index !== -1
                        ) {
                            updatedMessages[index] = {
                                ...updatedMessages[index],
                                ...parseLabelIDsInEvent(updatedMessages[index], Message)
                            };
                        }
                    });

                    if (updatedConversation.NumMessages !== updatedMessages.length) {
                        reloadConversation(ID);
                    } else {
                        cache.set(ID, {
                            Conversation: updatedConversation,
                            Messages: updatedMessages
                        });
                    }
                } catch (error) {
                    console.warn('Something went wrong on updating a conversation from an event.', error);
                    reloadConversation(ID);
                }
            }
        }
    };
};

/**
 * Check constantly for expired message in the cache
 */
const useConversationExpirationCheck = (cache: ConversationCache) => {
    const conversations = Object.values(cache.toObject())
        .map((conversationResult) => conversationResult?.Conversation)
        .filter(identity) as Conversation[];

    useExpirationCheck(conversations, (element) => cache.delete(element.ID || ''));
};

interface Props {
    children?: ReactNode;
    cache?: ConversationCache; // Only for testing purposes
}

/**
 * Provider for the message cache and listen to event manager for updates
 */
const ConversationProvider = ({ children, cache: testCache }: Props) => {
    const { subscribe } = useEventManager();
    const api = useApi();

    const realCache: ConversationCache = useInstance(() => {
        return createCache(createLRU({ max: 50 } as any));
    });

    const cache = testCache || realCache;

    useEffect(() => subscribe(conversationListener(cache, api)), []);

    useConversationExpirationCheck(cache);

    return <ConversationContext.Provider value={cache}>{children}</ConversationContext.Provider>;
};

export default ConversationProvider;
