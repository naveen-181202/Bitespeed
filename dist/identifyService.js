"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identifyContact = identifyContact;
const client_1 = require("@prisma/client");
const prisma_1 = require("./prisma");
function normalizeInput(email, phoneNumber) {
    return {
        email: email?.trim() || null,
        phoneNumber: phoneNumber === null || phoneNumber === undefined
            ? null
            : String(phoneNumber).trim() || null,
    };
}
function getPrimaryId(contact) {
    return contact.linkPrecedence === client_1.LinkPrecedence.primary
        ? contact.id
        : contact.linkedId;
}
function uniqueOrdered(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        if (!value || seen.has(value)) {
            continue;
        }
        seen.add(value);
        result.push(value);
    }
    return result;
}
function buildResponse(primary, contacts) {
    const sorted = [...contacts].sort((a, b) => {
        if (a.createdAt.getTime() !== b.createdAt.getTime()) {
            return a.createdAt.getTime() - b.createdAt.getTime();
        }
        return a.id - b.id;
    });
    const primaryFirst = [
        primary,
        ...sorted.filter((contact) => contact.id !== primary.id),
    ];
    return {
        contact: {
            primaryContatctId: primary.id,
            emails: uniqueOrdered(primaryFirst.map((contact) => contact.email)),
            phoneNumbers: uniqueOrdered(primaryFirst.map((contact) => contact.phoneNumber)),
            secondaryContactIds: sorted
                .filter((contact) => contact.id !== primary.id)
                .map((contact) => contact.id),
        },
    };
}
async function fetchClusterContactsForPrimaryIds(tx, primaryIds) {
    return tx.contact.findMany({
        where: {
            OR: [{ id: { in: primaryIds } }, { linkedId: { in: primaryIds } }],
            deletedAt: null,
        },
    });
}
async function consolidatePrimaries(tx, contacts) {
    const primaries = contacts.filter((contact) => contact.linkPrecedence === client_1.LinkPrecedence.primary);
    const sortedPrimaries = [...primaries].sort((a, b) => {
        if (a.createdAt.getTime() !== b.createdAt.getTime()) {
            return a.createdAt.getTime() - b.createdAt.getTime();
        }
        return a.id - b.id;
    });
    const canonicalPrimary = sortedPrimaries[0];
    const oldPrimaryIds = sortedPrimaries
        .filter((contact) => contact.id !== canonicalPrimary.id)
        .map((contact) => contact.id);
    if (oldPrimaryIds.length > 0) {
        await tx.contact.updateMany({
            where: { linkedId: { in: oldPrimaryIds }, deletedAt: null },
            data: { linkedId: canonicalPrimary.id },
        });
        await tx.contact.updateMany({
            where: { id: { in: oldPrimaryIds }, deletedAt: null },
            data: {
                linkedId: canonicalPrimary.id,
                linkPrecedence: client_1.LinkPrecedence.secondary,
            },
        });
    }
    return canonicalPrimary;
}
async function findDirectMatches(tx, input) {
    const orClauses = [];
    if (input.email) {
        orClauses.push({ email: input.email });
    }
    if (input.phoneNumber) {
        orClauses.push({ phoneNumber: input.phoneNumber });
    }
    if (orClauses.length === 0) {
        return [];
    }
    return tx.contact.findMany({
        where: {
            OR: orClauses,
            deletedAt: null,
        },
    });
}
async function identifyContact(rawEmail, rawPhoneNumber) {
    const input = normalizeInput(rawEmail, rawPhoneNumber);
    if (!input.email && !input.phoneNumber) {
        throw new Error("Either email or phoneNumber must be provided.");
    }
    return prisma_1.prisma.$transaction(async (tx) => {
        const directMatches = await findDirectMatches(tx, input);
        if (directMatches.length === 0) {
            const createdPrimary = await tx.contact.create({
                data: {
                    email: input.email,
                    phoneNumber: input.phoneNumber,
                    linkPrecedence: client_1.LinkPrecedence.primary,
                    linkedId: null,
                },
            });
            return buildResponse(createdPrimary, [createdPrimary]);
        }
        const involvedPrimaryIds = Array.from(new Set(directMatches.map((contact) => getPrimaryId(contact))));
        const clusterContacts = await fetchClusterContactsForPrimaryIds(tx, involvedPrimaryIds);
        const canonicalPrimary = await consolidatePrimaries(tx, clusterContacts);
        const canonicalContactsBeforeInsert = await fetchClusterContactsForPrimaryIds(tx, [
            canonicalPrimary.id,
        ]);
        const knownEmails = new Set(canonicalContactsBeforeInsert
            .map((contact) => contact.email)
            .filter((value) => Boolean(value)));
        const knownPhoneNumbers = new Set(canonicalContactsBeforeInsert
            .map((contact) => contact.phoneNumber)
            .filter((value) => Boolean(value)));
        const introducesNewEmail = Boolean(input.email && !knownEmails.has(input.email));
        const introducesNewPhone = Boolean(input.phoneNumber && !knownPhoneNumbers.has(input.phoneNumber));
        if (introducesNewEmail || introducesNewPhone) {
            await tx.contact.create({
                data: {
                    email: input.email,
                    phoneNumber: input.phoneNumber,
                    linkedId: canonicalPrimary.id,
                    linkPrecedence: client_1.LinkPrecedence.secondary,
                },
            });
        }
        const finalContacts = await fetchClusterContactsForPrimaryIds(tx, [
            canonicalPrimary.id,
        ]);
        const primary = finalContacts.find((contact) => contact.id === canonicalPrimary.id);
        if (!primary) {
            throw new Error("Primary contact resolution failed.");
        }
        return buildResponse(primary, finalContacts);
    });
}
