export type IdentifyRequestBody = {
  email?: string | null;
  phoneNumber?: string | number | null;
};

export type IdentifyResponse = {
  contact: {
    primaryContatctId: number;
    emails: string[];
    phoneNumbers: string[];
    secondaryContactIds: number[];
  };
};
