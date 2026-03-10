const STORAGE_KEYS = {
  encryptedApiKey: "imai.studio.apiKey",
  hasSeenSetup: "imai.studio.hasSeenSetup",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const FALLBACK_STORAGE_SECRET = "imai-studio-local-obfuscation";

type StoredCipher =
  | {
      mode: "aes-gcm";
      iv: string;
      value: string;
    }
  | {
      mode: "fallback";
      value: string;
    };

const getStorageSecret = () =>
  IMAI_STORAGE_SECRET || FALLBACK_STORAGE_SECRET;

const toBase64 = (value: Uint8Array) => {
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window.btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const createAesKey = async () => {
  if (!window.crypto?.subtle) {
    return null;
  }

  const secretBytes = encoder.encode(getStorageSecret());
  const hashedSecret = await window.crypto.subtle.digest("SHA-256", secretBytes);

  return window.crypto.subtle.importKey(
    "raw",
    hashedSecret,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
};

const encryptValue = async (value: string): Promise<string> => {
  const key = await createAesKey();
  if (!key || !window.crypto?.getRandomValues) {
    const fallback = `${getStorageSecret()}:${value}`;
    return JSON.stringify({
      mode: "fallback",
      value: window.btoa(fallback),
    } satisfies StoredCipher);
  }

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(value),
  );

  return JSON.stringify({
    mode: "aes-gcm",
    iv: toBase64(iv),
    value: toBase64(new Uint8Array(encrypted)),
  } satisfies StoredCipher);
};

const decryptValue = async (storedValue: string): Promise<string | null> => {
  try {
    const parsedValue = JSON.parse(storedValue) as StoredCipher;
    if (parsedValue.mode === "fallback") {
      const decoded = window.atob(parsedValue.value);
      const prefix = `${getStorageSecret()}:`;
      return decoded.startsWith(prefix)
        ? decoded.slice(prefix.length)
        : null;
    }

    const key = await createAesKey();
    if (!key) {
      return null;
    }

    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(parsedValue.iv),
      },
      key,
      fromBase64(parsedValue.value),
    );

    return decoder.decode(decrypted);
  } catch {
    return null;
  }
};

export const getStoredApiKey = async (): Promise<string | null> => {
  const encryptedValue = window.localStorage.getItem(STORAGE_KEYS.encryptedApiKey);
  if (!encryptedValue) {
    return null;
  }

  return decryptValue(encryptedValue);
};

export const setStoredApiKey = async (apiKey: string) => {
  const encryptedValue = await encryptValue(apiKey);
  window.localStorage.setItem(STORAGE_KEYS.encryptedApiKey, encryptedValue);
  window.localStorage.setItem(STORAGE_KEYS.hasSeenSetup, "true");
};

export const removeStoredApiKey = () => {
  window.localStorage.removeItem(STORAGE_KEYS.encryptedApiKey);
  window.localStorage.setItem(STORAGE_KEYS.hasSeenSetup, "true");
};

export const getHasSeenSetup = () =>
  window.localStorage.getItem(STORAGE_KEYS.hasSeenSetup) === "true";
