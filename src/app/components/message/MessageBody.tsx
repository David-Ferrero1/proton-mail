import { isPlainText } from 'proton-shared/lib/mail/messages';
import React, { useMemo } from 'react';
import { classnames, Button, Tooltip } from 'react-components';
import { c } from 'ttag';
import { getLightOrDark } from 'proton-shared/lib/themes/helpers';
import { MessageExtended } from '../../models/message';
import { locateBlockquote } from '../../helpers/message/messageBlockquote';

import './MessageBody.scss';

interface Props {
    messageLoaded: boolean;
    bodyLoaded: boolean;
    sourceMode: boolean;
    message: MessageExtended;
    originalMessageMode: boolean;
    toggleOriginalMessage?: () => void;
    /**
     * Needed for print message
     * true: don't show button, show full content
     * false: (default) show button and collapse blockquote (if one founded)
     */
    forceBlockquote?: boolean;
}

const MessageBody = ({
    messageLoaded,
    bodyLoaded,
    sourceMode: inputSourceMode,
    message,
    forceBlockquote = false,
    originalMessageMode,
    toggleOriginalMessage,
}: Props) => {
    const plain = isPlainText(message.data);

    const [content, blockquote] = useMemo(
        () => (plain ? [message.plainText as string, ''] : locateBlockquote(message.document)),
        [message.document?.innerHTML, message.plainText, plain]
    );

    const encryptedMode = messageLoaded && !!message.errors?.decryption?.length;
    const sourceMode = !encryptedMode && inputSourceMode;
    const decryptingMode = !encryptedMode && !sourceMode && !bodyLoaded && messageLoaded;
    const loadingMode = !messageLoaded;
    const contentMode = !encryptedMode && !sourceMode && bodyLoaded;
    const isBlockquote = blockquote !== '';
    const showButton = !forceBlockquote && isBlockquote;
    const showBlockquote = forceBlockquote || originalMessageMode;

    return (
        <div
            className={classnames([
                'message-content scroll-horizontal-if-needed relative bodyDecrypted',
                plain && 'plain',
                !loadingMode && getLightOrDark('', 'bg-white color-global-grey'),
            ])}
        >
            {encryptedMode && <pre>{message.data?.Body}</pre>}
            {sourceMode && <pre>{message.decryptedBody}</pre>}
            {(loadingMode || decryptingMode) && (
                <>
                    <div className="message-content-loading-placeholder mb0-25 mw15e" />
                    <div className="message-content-loading-placeholder mb0-25 mw40e" />
                    <div className="message-content-loading-placeholder mb0-25 mw50e" />
                    <div className="message-content-loading-placeholder mw8e" />
                </>
            )}
            {contentMode && (
                <>
                    {/* eslint-disable-next-line react/no-danger */}
                    <div dangerouslySetInnerHTML={{ __html: content }} />
                    {isBlockquote && (
                        <>
                            {showButton && (
                                <Tooltip
                                    title={
                                        originalMessageMode
                                            ? c('Info').t`Hide original message`
                                            : c('Info').t`Show original message`
                                    }
                                >
                                    <Button className="pm-button--small m0-5" onClick={() => toggleOriginalMessage?.()}>
                                        ...
                                    </Button>
                                </Tooltip>
                            )}
                            {/* eslint-disable-next-line react/no-danger */}
                            {showBlockquote && <div dangerouslySetInnerHTML={{ __html: blockquote }} />}
                        </>
                    )}
                </>
            )}
        </div>
    );
};

export default MessageBody;
