"use strict";
// SPDX-FileCopyrightText: 2023 Alliander NV
//
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_kms_1 = require("@aws-sdk/client-kms");
const base64url_1 = require("base64url");
const logger_1 = require("@aws-lambda-powertools/logger");
const KEY_ALIAS_CURRENT = process.env.CURRENT_KEY.toString();
const logger = new logger_1.Logger();
const handler = async (apiEvent, context) => {
    var _a, _b, _c, _d;
    const identityArn = getARNFromIdentity((_a = apiEvent.requestContext.identity) === null || _a === void 0 ? void 0 : _a.userArn);
    logger.debug(identityArn);
    if (identityArn === undefined || identityArn === null) {
        logger.info(`Unable to resolve identityArn for userArn: ${(_b = apiEvent.requestContext.identity) === null || _b === void 0 ? void 0 : _b.userArn}`);
        return respond('Unable to resolve identity', 400);
    }
    let aud = process.env.DEFAULT_AUDIENCE;
    if (apiEvent.queryStringParameters && apiEvent.queryStringParameters.aud) {
        aud = apiEvent.queryStringParameters.aud;
    }
    const kms = new client_kms_1.KMSClient({});
    // Get KeyID which will be sent as kid in JWT token
    const currentResponse = await kms.send(new client_kms_1.DescribeKeyCommand({ KeyId: `${KEY_ALIAS_CURRENT}` }));
    const currentKeyId = (_c = currentResponse.KeyMetadata) === null || _c === void 0 ? void 0 : _c.KeyId;
    if (currentKeyId === undefined) {
        return respond('KMS key could not be retrieved', 500);
    }
    // Retrieve Tags for KMS Key - the key is tagged with the `kid` from the JWK which is used in the JWT headers
    const listResourceTagsResponse = await kms.send(new client_kms_1.ListResourceTagsCommand({ KeyId: currentKeyId }));
    const kid = getTagValueFromTags('jwk_kid', (_d = listResourceTagsResponse.Tags) !== null && _d !== void 0 ? _d : []);
    if (kid == null) {
        return respond('KMS key is not correctly tagged', 500);
    }
    const iss = process.env.ISSUER;
    // JWT Token headers
    const headers = {
        alg: 'RS256',
        typ: 'JWT',
        kid: `${kid}`
    };
    // prepare token lifetime property values
    const issuedAtDate = new Date();
    const expirationDate = new Date(issuedAtDate);
    const notBeforeDate = new Date(issuedAtDate);
    expirationDate.setTime(expirationDate.getTime() + 60 * 60 * 1000); // valid for one hour
    notBeforeDate.setTime(notBeforeDate.getTime() - 5 * 60 * 1000); // 5m before issuedAtDate
    // JWT Token payload
    const payload = {
        sub: `${identityArn}`, // Set role arn as message for payload
        aud,
        iss,
        iat: Math.floor(issuedAtDate.getTime() / 1000),
        exp: Math.floor(expirationDate.getTime() / 1000),
        nbf: Math.floor(notBeforeDate.getTime() / 1000)
    };
    // Prepare message to be signed by KMS
    const tokenHeaders = (0, base64url_1.default)(JSON.stringify(headers));
    const tokenPayload = (0, base64url_1.default)(JSON.stringify(payload));
    // Sign message with KMS
    const signResponse = await kms.send(new client_kms_1.SignCommand({
        KeyId: currentKeyId,
        Message: Buffer.from(`${tokenHeaders}.${tokenPayload}`),
        SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
        MessageType: 'RAW'
    }));
    logger.debug(JSON.stringify(signResponse));
    const signature = Buffer
        .from(signResponse.Signature)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
    const token = `${tokenHeaders}.${tokenPayload}.${signature}`;
    logger.debug(token);
    return respond(JSON.stringify({
        token
    }));
};
exports.handler = handler;
function respond(message, statusCode = 200) {
    return {
        statusCode,
        body: message
    };
}
function getARNFromIdentity(identityArn) {
    var _a, _b;
    if (identityArn === undefined || identityArn === null) {
        return null;
    }
    // Regex for converting arn to base role
    const captGroups = [
        'arn:aws:sts:',
        '(?<regionName>[^:]*)', // group 1
        ':',
        '(?<accountId>\\d{12})', // group 2
        ':assumed-role\\/',
        '(?<roleName>[A-z0-9\\-]+?)', // group 3
        '\\/',
        '(?<user>[^:]*)', // group 4
        '$'
    ];
    const regex = new RegExp(captGroups.join(''));
    const { regionName, accountId, roleName } = (_b = (_a = regex.exec(identityArn)) === null || _a === void 0 ? void 0 : _a.groups) !== null && _b !== void 0 ? _b : {};
    if (regionName === undefined || accountId === undefined || roleName === undefined) {
        return null;
    }
    // Build base role arn
    return `arn:aws:iam:${regionName}:${accountId}:role/${roleName}`;
}
function getTagValueFromTags(tagKey, tags) {
    for (const tag of tags) {
        if (tag.TagKey === tagKey) {
            return tag.TagValue;
        }
    }
    return null;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguc2lnbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9pbmRleC5zaWduLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSw0Q0FBNEM7QUFDNUMsRUFBRTtBQUNGLHNDQUFzQzs7O0FBR3RDLG9EQUE4RztBQUM5Ryx5Q0FBaUM7QUFFakMsMERBQXNEO0FBRXRELE1BQU0saUJBQWlCLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFZLENBQUMsUUFBUSxFQUFFLENBQUE7QUFDN0QsTUFBTSxNQUFNLEdBQUcsSUFBSSxlQUFNLEVBQUUsQ0FBQTtBQUVwQixNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQUUsUUFBeUIsRUFBRSxPQUFnQixFQUFrQyxFQUFFOztJQUMzRyxNQUFNLFdBQVcsR0FBRyxrQkFBa0IsQ0FBQyxNQUFBLFFBQVEsQ0FBQyxjQUFjLENBQUMsUUFBUSwwQ0FBRSxPQUFPLENBQUMsQ0FBQTtJQUNqRixNQUFNLENBQUMsS0FBSyxDQUFDLFdBQVksQ0FBQyxDQUFBO0lBRTFCLElBQUksV0FBVyxLQUFLLFNBQVMsSUFBSSxXQUFXLEtBQUssSUFBSSxFQUFFLENBQUM7UUFDdEQsTUFBTSxDQUFDLElBQUksQ0FBQyw4Q0FBOEMsTUFBQSxRQUFRLENBQUMsY0FBYyxDQUFDLFFBQVEsMENBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQTtRQUN0RyxPQUFPLE9BQU8sQ0FBQyw0QkFBNEIsRUFBRSxHQUFHLENBQUMsQ0FBQTtJQUNuRCxDQUFDO0lBRUQsSUFBSSxHQUFHLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQTtJQUV0QyxJQUFJLFFBQVEsQ0FBQyxxQkFBcUIsSUFBSSxRQUFRLENBQUMscUJBQXFCLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDekUsR0FBRyxHQUFHLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLENBQUE7SUFDMUMsQ0FBQztJQUVELE1BQU0sR0FBRyxHQUFHLElBQUksc0JBQVMsQ0FB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QUc7S0FDSixDQUFBO0lBRUQsTUFBTSxLQUFLLEdBQUcsSUFBSSxNQUFNLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFBO0lBQzdDLE1BQU0sRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxHQUFHLE1BQUEsTUFBQSxLQUFLLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQywwQ0FBRSxNQUFNLG1DQUFJLEVBQUUsQ0FBQTtJQUVqRixJQUFJLFVBQVUsS0FBSyxTQUFTLElBQUksU0FBUyxLQUFLLFNBQVMsSUFBSSxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDbEYsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQsc0JBQXNCO0lBQ3RCLE9BQU8sZUFBZSxVQUFVLElBQUksU0FBUyxTQUFTLFFBQVEsRUFBRSxDQUFBO0FBQ2xFLENBQUM7QUFFRCxTQUFTLG1CQUFtQixDQUFFLE1BQWMsRUFBRSxJQUFXO0lBQ3ZELEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7UUFDdkIsSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLE1BQU0sRUFBRSxDQUFDO1lBQzFCLE9BQU8sR0FBRyxDQUFDLFFBQVEsQ0FBQTtRQUNyQixDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sSUFBSSxDQUFBO0FBQ2IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIFNQRFgtRmlsZUNvcHlyaWdodFRleHQ6IDIwMjMgQWxsaWFuZGVyIE5WXG4vL1xuLy8gU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcblxuaW1wb3J0IHsgQ29udGV4dCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0LCBBUElHYXRld2F5RXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJ1xuaW1wb3J0IHsgS01TQ2xpZW50LCBTaWduQ29tbWFuZCwgRGVzY3JpYmVLZXlDb21tYW5kLCBMaXN0UmVzb3VyY2VUYWdzQ29tbWFuZCwgVGFnIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWttcydcbmltcG9ydCBiYXNlNjR1cmwgZnJvbSAnYmFzZTY0dXJsJ1xuXG5pbXBvcnQgeyBMb2dnZXIgfSBmcm9tICdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL2xvZ2dlcidcblxuY29uc3QgS0VZX0FMSUFTX0NVUlJFTlQgPSBwcm9jZXNzLmVudi5DVVJSRU5UX0tFWSEudG9TdHJpbmcoKVxuY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpXG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGFwaUV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xuICBjb25zdCBpZGVudGl0eUFybiA9IGdldEFSTkZyb21JZGVudGl0eShhcGlFdmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eT8udXNlckFybilcbiAgbG9nZ2VyLmRlYnVnKGlkZW50aXR5QXJuISlcblxuICBpZiAoaWRlbnRpdHlBcm4gPT09IHVuZGVmaW5lZCB8fCBpZGVudGl0eUFybiA9PT0gbnVsbCkge1xuICAgIGxvZ2dlci5pbmZvKGBVbmFibGUgdG8gcmVzb2x2ZSBpZGVudGl0eUFybiBmb3IgdXNlckFybjogJHthcGlFdmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eT8udXNlckFybn1gKVxuICAgIHJldHVybiByZXNwb25kKCdVbmFibGUgdG8gcmVzb2x2ZSBpZGVudGl0eScsIDQwMClcbiAgfVxuXG4gIGxldCBhdWQgPSBwcm9jZXNzLmVudi5ERUZBVUxUX0FVRElFTkNFXG5cbiAgaWYgKGFwaUV2ZW50LnF1ZXJ5U3RyaW5nUGFyYW1ldGVycyAmJiBhcGlFdmVudC5xdWVyeVN0cmluZ1BhcmFtZXRlcnMuYXVkKSB7XG4gICAgYXVkID0gYXBpRXZlbnQucXVlcnlTdHJpbmdQYXJhbWV0ZXJzLmF1ZFxuICB9XG5cbiAgY29uc3Qga21zID0gbmV3IEtNU0NsaWVudCh7fSlcblxuICAvLyBHZXQgS2V5SUQgd2hpY2ggd2lsbCBiZSBzZW50IGFzIGtpZCBpbiBKV1QgdG9rZW5cbiAgY29uc3QgY3VycmVudFJlc3BvbnNlID0gYXdhaXQga21zLnNlbmQobmV3IERlc2NyaWJlS2V5Q29tbWFuZCh7IEtleUlkOiBgJHtLRVlfQUxJQVNfQ1VSUkVOVH1gIH0pKVxuICBjb25zdCBjdXJyZW50S2V5SWQgPSBjdXJyZW50UmVzcG9uc2UuS2V5TWV0YWRhdGE/LktleUlkXG5cbiAgaWYgKGN1cnJlbnRLZXlJZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIHJlc3BvbmQoJ0tNUyBrZXkgY291bGQgbm90IGJlIHJldHJpZXZlZCcsIDUwMClcbiAgfVxuXG4gIC8vIFJldHJpZXZlIFRhZ3MgZm9yIEtNUyBLZXkgLSB0aGUga2V5IGlzIHRhZ2dlZCB3aXRoIHRoZSBga2lkYCBmcm9tIHRoZSBKV0sgd2hpY2ggaXMgdXNlZCBpbiB0aGUgSldUIGhlYWRlcnNcbiAgY29uc3QgbGlzdFJlc291cmNlVGFnc1Jlc3BvbnNlID0gYXdhaXQga21zLnNlbmQobmV3IExpc3RSZXNvdXJjZVRhZ3NDb21tYW5kKHsgS2V5SWQ6IGN1cnJlbnRLZXlJZCB9KSlcbiAgY29uc3Qga2lkID0gZ2V0VGFnVmFsdWVGcm9tVGFncygnandrX2tpZCcsIGxpc3RSZXNvdXJjZVRhZ3NSZXNwb25zZS5UYWdzID8/IFtdKVxuXG4gIGlmIChraWQgPT0gbnVsbCkge1xuICAgIHJldHVybiByZXNwb25kKCdLTVMga2V5IGlzIG5vdCBjb3JyZWN0bHkgdGFnZ2VkJywgNTAwKVxuICB9XG5cbiAgY29uc3QgaXNzID0gcHJvY2Vzcy5lbnYuSVNTVUVSXG5cbiAgLy8gSldUIFRva2VuIGhlYWRlcnNcbiAgY29uc3QgaGVhZGVyczogYW55ID0ge1xuICAgIGFsZzogJ1JTMjU2JyxcbiAgICB0eXA6ICdKV1QnLFxuICAgIGtpZDogYCR7a2lkfWBcbiAgfVxuXG4gIC8vIHByZXBhcmUgdG9rZW4gbGlmZXRpbWUgcHJvcGVydHkgdmFsdWVzXG4gIGNvbnN0IGlzc3VlZEF0RGF0ZSA9IG5ldyBEYXRlKClcbiAgY29uc3QgZXhwaXJhdGlvbkRhdGUgPSBuZXcgRGF0ZShpc3N1ZWRBdERhdGUpXG4gIGNvbnN0IG5vdEJlZm9yZURhdGUgPSBuZXcgRGF0ZShpc3N1ZWRBdERhdGUpXG4gIGV4cGlyYXRpb25EYXRlLnNldFRpbWUoZXhwaXJhdGlvbkRhdGUuZ2V0VGltZSgpICsgNjAgKiA2MCAqIDEwMDApIC8vIHZhbGlkIGZvciBvbmUgaG91clxuICBub3RCZWZvcmVEYXRlLnNldFRpbWUobm90QmVmb3JlRGF0ZS5nZXRUaW1lKCkgLSA1ICogNjAgKiAxMDAwKSAvLyA1bSBiZWZvcmUgaXNzdWVkQXREYXRlXG5cbiAgLy8gSldUIFRva2VuIHBheWxvYWRcbiAgY29uc3QgcGF5bG9hZDogYW55ID0ge1xuICAgIHN1YjogYCR7aWRlbnRpdHlBcm59YCwgLy8gU2V0IHJvbGUgYXJuIGFzIG1lc3NhZ2UgZm9yIHBheWxvYWRcbiAgICBhdWQsXG4gICAgaXNzLFxuICAgIGlhdDogTWF0aC5mbG9vcihpc3N1ZWRBdERhdGUuZ2V0VGltZSgpIC8gMTAwMCksXG4gICAgZXhwOiBNYXRoLmZsb29yKGV4cGlyYXRpb25EYXRlLmdldFRpbWUoKSAvIDEwMDApLFxuICAgIG5iZjogTWF0aC5mbG9vcihub3RCZWZvcmVEYXRlLmdldFRpbWUoKSAvIDEwMDApXG4gIH1cblxuICAvLyBQcmVwYXJlIG1lc3NhZ2UgdG8gYmUgc2lnbmVkIGJ5IEtNU1xuICBjb25zdCB0b2tlbkhlYWRlcnMgPSBiYXNlNjR1cmwoSlNPTi5zdHJpbmdpZnkoaGVhZGVycykpXG4gIGNvbnN0IHRva2VuUGF5bG9hZCA9IGJhc2U2NHVybChKU09OLnN0cmluZ2lmeShwYXlsb2FkKSlcblxuICAvLyBTaWduIG1lc3NhZ2Ugd2l0aCBLTVNcbiAgY29uc3Qgc2lnblJlc3BvbnNlID0gYXdhaXQga21zLnNlbmQobmV3IFNpZ25Db21tYW5kKHtcbiAgICBLZXlJZDogY3VycmVudEtleUlkLFxuICAgIE1lc3NhZ2U6IEJ1ZmZlci5mcm9tKGAke3Rva2VuSGVhZGVyc30uJHt0b2tlblBheWxvYWR9YCksXG4gICAgU2lnbmluZ0FsZ29yaXRobTogJ1JTQVNTQV9QS0NTMV9WMV81X1NIQV8yNTYnLFxuICAgIE1lc3NhZ2VUeXBlOiAnUkFXJ1xuICB9KSlcbiAgbG9nZ2VyLmRlYnVnKEpTT04uc3RyaW5naWZ5KHNpZ25SZXNwb25zZSkpXG5cbiAgY29uc3Qgc2lnbmF0dXJlID0gQnVmZmVyXG4gICAgLmZyb20oc2lnblJlc3BvbnNlLlNpZ25hdHVyZSBhcyBVaW50OEFycmF5KVxuICAgIC50b1N0cmluZygnYmFzZTY0JylcbiAgICAucmVwbGFjZSgvXFwrL2csICctJylcbiAgICAucmVwbGFjZSgvXFwvL2csICdfJylcbiAgICAucmVwbGFjZSgvPS9nLCAnJylcblxuICBjb25zdCB0b2tlbiA9IGAke3Rva2VuSGVhZGVyc30uJHt0b2tlblBheWxvYWR9LiR7c2lnbmF0dXJlfWBcbiAgbG9nZ2VyLmRlYnVnKHRva2VuKVxuXG4gIHJldHVybiByZXNwb25kKEpTT04uc3RyaW5naWZ5KHtcbiAgICB0b2tlblxuICB9KSlcbn1cblxuZnVuY3Rpb24gcmVzcG9uZCAobWVzc2FnZTogc3RyaW5nLCBzdGF0dXNDb2RlOiBudW1iZXIgPSAyMDApIHtcbiAgcmV0dXJuIHtcbiAgICBzdGF0dXNDb2RlLFxuICAgIGJvZHk6IG1lc3NhZ2VcbiAgfVxufVxuXG5mdW5jdGlvbiBnZXRBUk5Gcm9tSWRlbnRpdHkgKGlkZW50aXR5QXJuOiBzdHJpbmcgfCBudWxsKSB7XG4gIGlmIChpZGVudGl0eUFybiA9PT0gdW5kZWZpbmVkIHx8IGlkZW50aXR5QXJuID09PSBudWxsKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8vIFJlZ2V4IGZvciBjb252ZXJ0aW5nIGFybiB0byBiYXNlIHJvbGVcbiAgY29uc3QgY2FwdEdyb3VwcyA9IFtcbiAgICAnYXJuOmF3czpzdHM6JyxcbiAgICAnKD88cmVnaW9uTmFtZT5bXjpdKiknLCAvLyBncm91cCAxXG4gICAgJzonLFxuICAgICcoPzxhY2NvdW50SWQ+XFxcXGR7MTJ9KScsIC8vIGdyb3VwIDJcbiAgICAnOmFzc3VtZWQtcm9sZVxcXFwvJyxcbiAgICAnKD88cm9sZU5hbWU+W0EtejAtOVxcXFwtXSs/KScsIC8vIGdyb3VwIDNcbiAgICAnXFxcXC8nLFxuICAgICcoPzx1c2VyPlteOl0qKScsIC8vIGdyb3VwIDRcbiAgICAnJCdcbiAgXVxuXG4gIGNvbnN0IHJlZ2V4ID0gbmV3IFJlZ0V4cChjYXB0R3JvdXBzLmpvaW4oJycpKVxuICBjb25zdCB7IHJlZ2lvbk5hbWUsIGFjY291bnRJZCwgcm9sZU5hbWUgfSA9IHJlZ2V4LmV4ZWMoaWRlbnRpdHlBcm4pPy5ncm91cHMgPz8ge31cblxuICBpZiAocmVnaW9uTmFtZSA9PT0gdW5kZWZpbmVkIHx8IGFjY291bnRJZCA9PT0gdW5kZWZpbmVkIHx8IHJvbGVOYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLy8gQnVpbGQgYmFzZSByb2xlIGFyblxuICByZXR1cm4gYGFybjphd3M6aWFtOiR7cmVnaW9uTmFtZX06JHthY2NvdW50SWR9OnJvbGUvJHtyb2xlTmFtZX1gXG59XG5cbmZ1bmN0aW9uIGdldFRhZ1ZhbHVlRnJvbVRhZ3MgKHRhZ0tleTogc3RyaW5nLCB0YWdzOiBUYWdbXSkge1xuICBmb3IgKGNvbnN0IHRhZyBvZiB0YWdzKSB7XG4gICAgaWYgKHRhZy5UYWdLZXkgPT09IHRhZ0tleSkge1xuICAgICAgcmV0dXJuIHRhZy5UYWdWYWx1ZVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG4iXX0=