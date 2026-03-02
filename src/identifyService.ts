import { Contact, LinkPrecedence, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { IdentifyResponse } from "./types";

type NormalizedInput = {
  email: string | null;
  phoneNumber: string | null;
};

function normalizeInput(
  email?: string | null,
  phoneNumber?: string | number | null
): NormalizedInput {
  return {
    email: email?.trim() || null,
    phoneNumber:
      phoneNumber === null || phoneNumber === undefined
        ? null
        : String(phoneNumber).trim() || null,
  };
}

function getPrimaryId(contact: Contact): number {
  return contact.linkPrecedence === LinkPrecedence.primary
    ? contact.id
    : (contact.linkedId as number);
}

function uniqueOrdered(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

function buildResponse(primary: Contact, contacts: Contact[]): IdentifyResponse {
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

async function fetchClusterContactsForPrimaryIds(
  tx: Prisma.TransactionClient,
  primaryIds: number[]
): Promise<Contact[]> {
  return tx.contact.findMany({
    where: {
      OR: [{ id: { in: primaryIds } }, { linkedId: { in: primaryIds } }],
      deletedAt: null,
    },
  });
}

async function consolidatePrimaries(
  tx: Prisma.TransactionClient,
  contacts: Contact[]
): Promise<Contact> {
  const primaries = contacts.filter(
    (contact) => contact.linkPrecedence === LinkPrecedence.primary
  );

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
        linkPrecedence: LinkPrecedence.secondary,
      },
    });
  }

  return canonicalPrimary;
}

async function findDirectMatches(
  tx: Prisma.TransactionClient,
  input: NormalizedInput
): Promise<Contact[]> {
  const orClauses: Prisma.ContactWhereInput[] = [];

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

export async function identifyContact(
  rawEmail?: string | null,
  rawPhoneNumber?: string | number | null
): Promise<IdentifyResponse> {
  const input = normalizeInput(rawEmail, rawPhoneNumber);

  if (!input.email && !input.phoneNumber) {
    throw new Error("Either email or phoneNumber must be provided.");
  }

  return prisma.$transaction(async (tx) => {
    const directMatches = await findDirectMatches(tx, input);

    if (directMatches.length === 0) {
      const createdPrimary = await tx.contact.create({
        data: {
          email: input.email,
          phoneNumber: input.phoneNumber,
          linkPrecedence: LinkPrecedence.primary,
          linkedId: null,
        },
      });

      return buildResponse(createdPrimary, [createdPrimary]);
    }

    const involvedPrimaryIds = Array.from(
      new Set(directMatches.map((contact) => getPrimaryId(contact)))
    );

    const clusterContacts = await fetchClusterContactsForPrimaryIds(
      tx,
      involvedPrimaryIds
    );
    const canonicalPrimary = await consolidatePrimaries(tx, clusterContacts);

    const canonicalContactsBeforeInsert = await fetchClusterContactsForPrimaryIds(tx, [
      canonicalPrimary.id,
    ]);

    const knownEmails = new Set(
      canonicalContactsBeforeInsert
        .map((contact) => contact.email)
        .filter((value): value is string => Boolean(value))
    );
    const knownPhoneNumbers = new Set(
      canonicalContactsBeforeInsert
        .map((contact) => contact.phoneNumber)
        .filter((value): value is string => Boolean(value))
    );

    const introducesNewEmail = Boolean(input.email && !knownEmails.has(input.email));
    const introducesNewPhone = Boolean(
      input.phoneNumber && !knownPhoneNumbers.has(input.phoneNumber)
    );

    if (introducesNewEmail || introducesNewPhone) {
      await tx.contact.create({
        data: {
          email: input.email,
          phoneNumber: input.phoneNumber,
          linkedId: canonicalPrimary.id,
          linkPrecedence: LinkPrecedence.secondary,
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
