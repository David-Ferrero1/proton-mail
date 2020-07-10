import { arrayToBinaryString, encodeBase64, encryptMessage, generateSessionKey } from 'pmcrypto';
import { MIME_TYPES, PACKAGE_TYPE } from 'proton-shared/lib/constants';
import { Api } from 'proton-shared/lib/interfaces';
import { srpGetVerify } from 'proton-shared/lib/srp';
import { AES256 } from '../../constants';
import { MapSendPreferences, SendPreferences } from '../../models/crypto';

import { Package, Packages } from './sendTopPackages';
import { Message, MessageExtendedWithData } from '../../models/message';
import { getAttachments, isEO } from '../message/messages';

const { PLAINTEXT, DEFAULT, MIME } = MIME_TYPES;
const { SEND_PM, SEND_CLEAR, SEND_PGP_INLINE, SEND_PGP_MIME, SEND_EO } = PACKAGE_TYPE;

export const SEND_MIME = 32; // TODO update proton-shared constant

/**
 * Package for a ProtonMail user.
 */
const sendPM = async ({ publicKeys }: Pick<SendPreferences, 'publicKeys'>, message: Message) => ({
    Type: SEND_PM,
    PublicKey: (publicKeys?.length && publicKeys[0]) || undefined,
    Signature: getAttachments(message).every(({ Signature }) => Signature)
});

/**
 * Package for a outside user using ProtonMail encryption
 */
const sendPMEncryptedOutside = async (message: Message, api: Api) => {
    try {
        const sessionKey = await generateSessionKey(AES256);
        const Token = encodeBase64(arrayToBinaryString(sessionKey));

        const [{ data: EncToken }, { Auth }] = await Promise.all([
            encryptMessage({ data: Token, publicKeys: [], passwords: [message.Password] }),
            srpGetVerify({ api, credentials: { password: message.Password || '' } })
        ]);

        return {
            Auth,
            Type: PACKAGE_TYPE.SEND_EO,
            PasswordHint: message.PasswordHint,
            Token,
            EncToken,
            Signature: +message.Attachments.every(({ Signature }) => Signature)
        };
    } catch (err) {
        // TODO: mark encryption failed
        console.error(err);
        throw err;
    }
};

/**
 * Package for a PGP/MIME user.
 */
const sendPGPMime = async ({ encrypt, sign, publicKeys }: Pick<SendPreferences, 'encrypt' | 'sign' | 'publicKeys'>) => {
    if (encrypt) {
        return {
            Type: SEND_PGP_MIME,
            PublicKey: (publicKeys?.length && publicKeys[0]) || undefined
        };
    }

    // PGP/MIME signature only
    return {
        Type: SEND_MIME,
        Signature: +sign
    };
};

/**
 * Package for a PGP/Inline user.
 */
const sendPGPInline = async (
    { encrypt, sign, publicKeys }: Pick<SendPreferences, 'encrypt' | 'sign' | 'publicKeys'>,
    message: Message
) => {
    if (encrypt) {
        return {
            Type: SEND_PGP_INLINE,
            PublicKey: (publicKeys?.length && publicKeys[0]) || undefined,
            Signature: getAttachments(message).every(({ Signature }) => Signature)
        };
    }

    // PGP/Inline signature only
    return {
        Type: SEND_CLEAR,
        Signature: +sign
    };
};

/**
 * Package for an unencrypted user
 */
const sendClear = async () => ({ Type: SEND_CLEAR, Signature: 0 });

/**
 * Attach the subpackages for encryptMessage to the given top level packages. The packages need to be encrypted before
 * they can be send to the api. See encryptPackages for that.
 */
export const attachSubPackages = async (
    packages: Packages,
    message: MessageExtendedWithData,
    emails: string[],
    mapSendPrefs: MapSendPreferences,
    api: Api
): Promise<Packages> => {
    const bindPackageSet = async (promise: Promise<Package>, email: string, type: MIME_TYPES) => {
        const pack = await promise;
        const packageToUpdate = packages[type] as Package;

        if (!packageToUpdate.Addresses) {
            packageToUpdate.Addresses = {};
        }
        if (!packageToUpdate.Type) {
            packageToUpdate.Type = 0;
        }

        packageToUpdate.Addresses[email] = pack;
        packageToUpdate.Type |= pack.Type || 0;
    };

    const promises = emails.map((email: string) => {
        const { encrypt, sign, pgpScheme, mimeType, publicKeys } = mapSendPrefs[email];
        const packageType = mimeType === 'text/html' ? DEFAULT : PLAINTEXT;

        switch (pgpScheme) {
            case SEND_PM:
                return bindPackageSet(sendPM({ publicKeys }, message.data), email, packageType);
            case SEND_PGP_MIME:
                if (!sign && !encrypt) {
                    return bindPackageSet(sendClear(), email, DEFAULT);
                }
                return bindPackageSet(sendPGPMime({ encrypt, sign, publicKeys }), email, MIME);
            case SEND_PGP_INLINE:
                return bindPackageSet(sendPGPInline({ encrypt, sign, publicKeys }, message.data), email, PLAINTEXT);
            case SEND_EO:
            case SEND_CLEAR:
                // Encrypted for outside (EO)
                if (isEO(message.data)) {
                    return bindPackageSet(sendPMEncryptedOutside(message.data, api), email, packageType);
                }
                return bindPackageSet(sendClear(), email, packageType);
        }
    });

    await Promise.all(promises);
    return packages;
};
