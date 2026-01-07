// modules/roleDivider.js

/**
 * Role Divider Module
 * Handles splitting messages based on role divider tags:
 * <<<[ROLE_DIVIDE_SYSTEM]>>> ... <<<[END_ROLE_DIVIDE_SYSTEM]>>>
 * <<<[ROLE_DIVIDE_ASSISTANT]>>> ... <<<[END_ROLE_DIVIDE_ASSISTANT]>>>
 * <<<[ROLE_DIVIDE_USER]>>> ... <<<[END_ROLE_DIVIDE_USER]>>>
 */

const TAGS = {
    SYSTEM: {
        START: '<<<[ROLE_DIVIDE_SYSTEM]>>>',
        END: '<<<[END_ROLE_DIVIDE_SYSTEM]>>>',
        ROLE: 'system'
    },
    ASSISTANT: {
        START: '<<<[ROLE_DIVIDE_ASSISTANT]>>>',
        END: '<<<[END_ROLE_DIVIDE_ASSISTANT]>>>',
        ROLE: 'assistant'
    },
    USER: {
        START: '<<<[ROLE_DIVIDE_USER]>>>',
        END: '<<<[END_ROLE_DIVIDE_USER]>>>',
        ROLE: 'user'
    }
};

/**
 * Helper to normalize text for ignore list matching.
 * Removes \n, \, and spaces.
 */
function normalizeForIgnore(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/[\n\\ ]/g, '');
}

/**
 * Process a single message content and split it into multiple messages if tags are present.
 * @param {Object} message - The original message object {role, content}.
 * @param {Object} options - Configuration options.
 * @param {Array<string>} options.ignoreList - List of content strings to ignore (keep tags as is).
 * @param {Object} options.switches - Granular switches { system: bool, assistant: bool, user: bool }.
 * @returns {Array<Object>} - Array of resulting messages.
 */
function processSingleMessage(message, { ignoreList = [], switches = { system: true, assistant: true, user: true } } = {}) {
    if (typeof message.content !== 'string') {
        return [message];
    }

    let text = message.content;
    const baseRole = message.role;
    const resultMessages = [];
    let currentTextBuffer = "";
    let cursor = 0;

    // Identify protected blocks: TOOL_REQUEST and DailyNote
    const protectedBlocks = [];
    const blockMarkers = [
        { start: '<<<[TOOL_REQUEST]>>>', end: '<<<[END_TOOL_REQUEST]>>>' },
        { start: '<<<DailyNoteStart>>>', end: '<<<DailyNoteEnd>>>' }
    ];

    for (const marker of blockMarkers) {
        let searchPos = 0;
        while (true) {
            const startIdx = text.indexOf(marker.start, searchPos);
            if (startIdx === -1) break;
            const endIdx = text.indexOf(marker.end, startIdx + marker.start.length);
            if (endIdx === -1) {
                searchPos = startIdx + marker.start.length;
                continue;
            }
            protectedBlocks.push({ start: startIdx, end: endIdx + marker.end.length });
            searchPos = endIdx + marker.end.length;
        }
    }

    // Sort protected blocks by start index
    protectedBlocks.sort((a, b) => a.start - b.start);

    const normalizedIgnoreList = ignoreList.map(normalizeForIgnore);

    while (cursor < text.length) {
        // Check if current cursor is inside a protected block
        const currentBlock = protectedBlocks.find(b => cursor >= b.start && cursor < b.end);
        if (currentBlock) {
            currentTextBuffer += text.substring(cursor, currentBlock.end);
            cursor = currentBlock.end;
            continue;
        }

        // Find the first occurrence of ANY start tag after cursor, but not inside protected blocks
        let firstTag = null;
        let firstTagIndex = -1;

        for (const key in TAGS) {
            const tagConfig = TAGS[key];
            // Skip if this role's switch is off
            if (!switches[tagConfig.ROLE]) continue;

            let searchIdx = cursor;
            while (true) {
                const index = text.indexOf(tagConfig.START, searchIdx);
                if (index === -1) break;

                // Check if this tag is inside a protected block
                const isProtected = protectedBlocks.some(b => index >= b.start && index < b.end);
                if (isProtected) {
                    searchIdx = index + tagConfig.START.length;
                    continue;
                }

                if (firstTagIndex === -1 || index < firstTagIndex) {
                    firstTagIndex = index;
                    firstTag = tagConfig;
                }
                break;
            }
        }

        // If no more tags found, append remaining text and break
        if (firstTagIndex === -1) {
            currentTextBuffer += text.substring(cursor);
            break;
        }

        // Append text before the tag to buffer
        currentTextBuffer += text.substring(cursor, firstTagIndex);

        // Look for the corresponding end tag
        const contentStartIndex = firstTagIndex + firstTag.START.length;
        const endTagIndex = text.indexOf(firstTag.END, contentStartIndex);

        if (endTagIndex === -1) {
            // No matching end tag found: Remove the start tag and treat as normal text
            cursor = contentStartIndex;
        } else {
            // Matching end tag found
            const innerContent = text.substring(contentStartIndex, endTagIndex);

            // Check ignore list with strict matching (normalized)
            const normalizedInner = normalizeForIgnore(innerContent);
            if (normalizedIgnoreList.includes(normalizedInner)) {
                // If ignored, treat the whole block (tags + content) as normal text
                currentTextBuffer += firstTag.START + innerContent + firstTag.END;
                cursor = endTagIndex + firstTag.END.length;
            } else {
                // Valid split block
                
                // 1. Push accumulated buffer as base role message (if not empty or just whitespace)
                if (currentTextBuffer.trim().length > 0) {
                    resultMessages.push({ role: baseRole, content: currentTextBuffer });
                }
                currentTextBuffer = "";

                // 2. Push inner content as new role message
                resultMessages.push({ role: firstTag.ROLE, content: innerContent });

                // 3. Move cursor past the end tag
                cursor = endTagIndex + firstTag.END.length;
            }
        }
    }

    // Push any remaining text in buffer (if not empty or just whitespace)
    if (currentTextBuffer.trim().length > 0) {
        resultMessages.push({ role: baseRole, content: currentTextBuffer });
    }

    // If the result is empty (e.g. original was empty or only contained tags), return original
    if (resultMessages.length === 0) {
        return [message];
    }

    return resultMessages;
}

/**
 * Process an array of messages.
 * @param {Array<Object>} messages - Array of message objects.
 * @param {Object} options - Configuration options.
 * @param {Array<string>} options.ignoreList - List of content strings to ignore.
 * @param {Object} options.switches - Granular switches { system: bool, assistant: bool, user: bool }.
 * @param {number} options.skipCount - Number of initial messages to skip (e.g. SystemPrompt).
 * @returns {Array<Object>} - New array of processed messages.
 */
function process(messages, { ignoreList = [], switches = { system: true, assistant: true, user: true }, skipCount = 0 } = {}) {
    if (!Array.isArray(messages)) {
        return messages;
    }

    const newMessages = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (i < skipCount) {
            newMessages.push(msg);
            continue;
        }
        const processed = processSingleMessage(msg, { ignoreList, switches });
        newMessages.push(...processed);
    }
    return newMessages;
}

module.exports = {
    process
};