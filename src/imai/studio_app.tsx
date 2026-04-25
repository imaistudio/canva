/* eslint-disable formatjs/no-literal-string-in-jsx */
import {
  Alert,
  Button,
  Carousel,
  CogIcon,
  EmbedCard,
  FileInput,
  FileInputItem,
  FormField,
  HorizontalCard,
  ImageCard,
  Masonry,
  MasonryItem,
  ProgressBar,
  Rows,
  SearchIcon,
  PlusIcon,
  ArrowDownIcon,
  MultilineInput,
  Slider,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  SurfaceHeader,
  Text,
  TextInput,
  Title,
  TrashIcon,
  VideoCard,
} from "@canva/app-ui-kit";
import { upload, type ImageMimeType, type VideoMimeType } from "@canva/asset";
import { addElementAtPoint, getCurrentPageContext } from "@canva/design";
import { requestOpenExternalUrl } from "@canva/platform";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type UIEvent,
} from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  getCredits,
  getGenerationStatus,
  getMarketingLibrary,
  startEcommerceGeneration,
  startMarketingGeneration,
  uploadFileToTempfile,
  verifyApiKey,
} from "./api";
import {
  getHasSeenSetup,
  getStoredApiKey,
  removeStoredApiKey,
  setStoredApiKey,
} from "./storage";
import {
  buildMarketingPrompt,
  getCompletedJobResult,
  getGeneratedImagePlacements,
  mapEcommerceResultToAssets,
  mapLibraryResponseGenerations,
  mapMarketingResultToAssets,
  pollUntilCompleted as pollGenerationJobUntilCompleted,
} from "./studio_app_logic";
import type {
  CreditBalance,
  EcommerceGenerationResponse,
  GenerationAsset,
  LibraryResponse,
  MarketingGenerationResponse,
} from "./types";
import * as styles from "styles/imai.css";

const LIBRARY_PAGE_SIZE = 24;
const INITIAL_LIBRARY_PAGE_SIZE = 36;
const LIBRARY_SCROLL_THRESHOLD_PX = 240;
const PROMPT_MIN_ROWS = 5;
const MIN_MARKETING_IMAGE_COUNT = 1;
const MAX_MARKETING_IMAGE_COUNT = 5;
const CANVA_UPLOAD_ATTEMPTS = 3;
const CANVA_UPLOAD_RETRY_DELAY_MS = 1500;
const FALLBACK_THUMBNAIL_URL =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjU2IiBoZWlnaHQ9IjI1NiIgdmlld0JveD0iMCAwIDI1NiAyNTYiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjI1NiIgaGVpZ2h0PSIyNTYiIGZpbGw9IiNmMmYzZjUiLz48cGF0aCBkPSJNMzIgMTkybDQ4LTY0IDQwIDQ4IDMyLTQwIDcyIDg4SDMyeiIgZmlsbD0iI2Q5ZGRlMyIvPjxjaXJjbGUgY3g9IjE3NiIgY3k9IjgwIiByPSIyNCIgZmlsbD0iI2Q5ZGRlMyIvPjwvc3ZnPg==";

type AppStage = "booting" | "showcase" | "setup" | "verifying" | "ready";
type GenerationState = "idle" | "submitting" | "polling";
type ContentTab = "media" | "catalogue" | "library";
type ImagePlacement = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type GenerationJobResult =
  | MarketingGenerationResponse
  | EcommerceGenerationResponse;

interface EcommerceDetailsView {
  title?: string;
  description?: string;
  features: string[];
  specifications: Record<string, string>;
}

interface ShowcaseCard {
  title: string;
  description: string;
  thumbnailUrl: string;
}

const SHOWCASE_DESCRIPTION_BREAK_PATTERN = /<br\s*\/?>|\n/g;

interface UploadedSource {
  tempfileFileId: string;
  tempfileFileUrl: string;
  previewUrl: string;
  expiryTime: number;
  localPreviewUrl: string;
  fileName: string;
}

interface GenerationPanelProps {
  source: UploadedSource | null;
  uploadBusy: boolean;
  uploadError: string;
  prompt: string;
  promptPlaceholder: string;
  promptLabel: string;
  imageCount?: number;
  onImageCountChange?: (value: number) => void;
  onPromptChange: (value: string) => void;
  onRemoveSource: () => void;
  onFileChange: (file: File | null) => Promise<void>;
  onFileReject: () => void;
  actionLabel: string;
  actionBusy: boolean;
  onGenerate: () => Promise<void>;
  credits: CreditBalance | null;
  showcaseCards: ShowcaseCard[];
  details?: EcommerceDetailsView | null;
}

const maskApiKey = (value: string) => {
  if (value.length <= 8) {
    return "•".repeat(value.length);
  }

  return `${value.slice(0, 7)}${"•".repeat(Math.max(4, value.length - 11))}${value.slice(-4)}`;
};

const SETTINGS_FAQS = [
  {
    question: "What is this key for?",
    answer: "It connects Canva to your IMAI.Studio account.",
  },
  {
    question: "Where do I get my API key?",
    answer: "Log in to IMAI.Studio, open Extensions, then select Canva.",
  },
  {
    question: "Why is my key hidden?",
    answer: "The saved key is masked here for safety.",
  },
  {
    question: "Can I change the key later?",
    answer: "Yes. Remove the current key and add a new one anytime.",
  },
  {
    question: "Why are generations not starting?",
    answer:
      "Check that your key is valid and your IMAI.Studio account is active.",
  },
] as const;

const SUPPORT_EMAIL = "tech@IMAI.Studio";

const mapLibraryResponse = (response: LibraryResponse): GenerationAsset[] =>
  mapLibraryResponseGenerations(response.generations);

const mergeAssetsById = (
  currentAssets: GenerationAsset[],
  nextAssets: GenerationAsset[],
) => {
  const seenAssetIds = new Set(currentAssets.map((asset) => asset.id));
  const uniqueNextAssets = nextAssets.filter(
    (asset) => !seenAssetIds.has(asset.id),
  );

  return [...currentAssets, ...uniqueNextAssets];
};

const getLibraryAssetDimensions = (asset: GenerationAsset) => {
  const width = asset.metadata?.width;
  const height = asset.metadata?.height;

  if (
    typeof width === "number" &&
    typeof height === "number" &&
    width > 0 &&
    height > 0
  ) {
    return {
      aspectRatio: width / height,
      targetHeightPx: height,
      targetWidthPx: width,
    };
  }

  return {
    aspectRatio: 1,
    targetHeightPx: 160,
    targetWidthPx: 160,
  };
};

const MEDIA_SHOWCASE_CARDS: ShowcaseCard[] = [
  {
    title: "One Click Studio",
    description:
      "Turn product ideas into high-end<br />lifestyle photography in seconds",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/01.jpg",
  },
  {
    title: "High-End Marketing, Zero Setup",
    description: "Create polished lifestyle shots<br />without studio setup",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/02.jpg",
  },
  {
    title: "Multiple Angles in One Go",
    description: "Generate campaign-ready angles<br />in one click",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/03.jpg",
  },
  {
    title: "Zero Setup",
    description: "Create product scenes instantly<br />from one image",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/04.jpg",
  },
];

const CATALOGUE_SHOWCASE_CARDS: ShowcaseCard[] = [
  {
    title: "E-comm Photos",
    description: "Generate polished product shots<br />for ecommerce",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/05.webp",
  },
  {
    title: "Multiple Angles",
    description: "Create listing-ready angles<br />in one generation",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/06.webp",
  },
  {
    title: "Modern Aesthetics",
    description: "Place products on clean<br />premium backgrounds",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/07.webp",
  },
  {
    title: "Instant Variety",
    description: "Create close-ups and wide shots<br />in seconds",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/08.webp",
  },
];

type VideoCardMimeType =
  | "video/avi"
  | "video/x-msvideo"
  | "image/gif"
  | "video/x-m4v"
  | "video/x-matroska"
  | "video/quicktime"
  | "video/mp4"
  | "video/mpeg"
  | "video/webm";

const normalizeImageMimeType = (
  mimeType: string | null | undefined,
): ImageMimeType | null => {
  const normalizedMimeType = mimeType?.split(";")[0]?.trim().toLowerCase();

  switch (normalizedMimeType) {
    case "image/jpeg":
    case "image/heic":
    case "image/png":
    case "image/svg+xml":
    case "image/webp":
    case "image/tiff":
      return normalizedMimeType;
    default:
      return null;
  }
};

const inferImageMimeTypeFromUrl = (url: string): ImageMimeType | null => {
  let pathname = url;

  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split("?")[0] || url;
  }

  const normalizedPathname = pathname.toLowerCase();

  if (
    normalizedPathname.endsWith(".jpg") ||
    normalizedPathname.endsWith(".jpeg")
  ) {
    return "image/jpeg";
  }

  if (normalizedPathname.endsWith(".png")) {
    return "image/png";
  }

  if (normalizedPathname.endsWith(".webp")) {
    return "image/webp";
  }

  if (
    normalizedPathname.endsWith(".tif") ||
    normalizedPathname.endsWith(".tiff")
  ) {
    return "image/tiff";
  }

  if (normalizedPathname.endsWith(".heic")) {
    return "image/heic";
  }

  if (
    normalizedPathname.endsWith(".svg") ||
    normalizedPathname.endsWith(".svgz")
  ) {
    return "image/svg+xml";
  }

  return null;
};

const fetchImageMimeTypeFromUrl = async (
  url: string,
): Promise<ImageMimeType | null> => {
  try {
    const response = await fetch(url, { method: "HEAD" });

    if (!response.ok) {
      return null;
    }

    return normalizeImageMimeType(response.headers.get("Content-Type"));
  } catch {
    return null;
  }
};

const inferImageMimeType = async (
  asset: GenerationAsset,
): Promise<ImageMimeType> => {
  return (
    normalizeImageMimeType(asset.metadata?.mimeType) ||
    (await fetchImageMimeTypeFromUrl(asset.url)) ||
    inferImageMimeTypeFromUrl(asset.url) ||
    "image/jpeg"
  );
};

const inferVideoMimeType = (asset: GenerationAsset) => {
  if (asset.metadata?.mimeType?.startsWith("video/")) {
    return asset.metadata.mimeType as VideoMimeType;
  }

  return "video/mp4";
};

const inferVideoCardMimeType = (asset: GenerationAsset): VideoCardMimeType => {
  switch (asset.metadata?.mimeType) {
    case "video/avi":
    case "video/x-msvideo":
    case "image/gif":
    case "video/x-m4v":
    case "video/x-matroska":
    case "video/quicktime":
    case "video/mp4":
    case "video/mpeg":
    case "video/webm":
      return asset.metadata.mimeType;
    default:
      return "video/mp4";
  }
};

const openExternalUrl = async (url: string) => {
  await requestOpenExternalUrl({ url });
};

const openExternalUrlAsset = async (asset: GenerationAsset) => {
  await openExternalUrl(asset.url);
};

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Please try again.";

const isRetryableCanvaUploadError = (error: unknown) => {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes("internal_error") ||
    message.includes("something unexpected") ||
    message.includes("failed to fetch") ||
    message.includes("temporarily unavailable")
  );
};

const revokeSourcePreviewUrl = (source: UploadedSource | null) => {
  if (source?.localPreviewUrl) {
    URL.revokeObjectURL(source.localPreviewUrl);
  }
};

const uploadAssetToCanva = async (
  asset: GenerationAsset,
  options?: { waitUntilUploaded?: boolean },
) => {
  if (asset.type === "image") {
    const imageUploadOptions = {
      type: "image",
      name: asset.label,
      mimeType: await inferImageMimeType(asset),
      url: asset.url,
      thumbnailUrl: FALLBACK_THUMBNAIL_URL,
      aiDisclosure: "app_generated",
    } as const;

    const queuedImage = await upload(
      asset.metadata?.width && asset.metadata?.height
        ? {
            ...imageUploadOptions,
            width: asset.metadata.width,
            height: asset.metadata.height,
          }
        : imageUploadOptions,
    );

    if (options?.waitUntilUploaded) {
      await queuedImage.whenUploaded();
    }

    return queuedImage.ref;
  }

  return null;
};

const addImageAssetToDesign = async (
  asset: GenerationAsset,
  placement?: ImagePlacement,
  options?: { waitUntilUploaded?: boolean },
) => {
  const ref = await uploadAssetToCanva(asset, options);
  if (!ref) {
    return;
  }

  const element = {
    type: "image",
    ref,
    altText: {
      text: asset.label,
      decorative: false,
    },
    ...placement,
  } as const;

  await addElementAtPoint(element);
};

const addImageAssetToDesignWithRetry = async (
  asset: GenerationAsset,
  placement?: ImagePlacement,
) => {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= CANVA_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      await addImageAssetToDesign(asset, placement, {
        waitUntilUploaded: true,
      });
      return;
    } catch (error) {
      lastError = error;

      if (
        attempt === CANVA_UPLOAD_ATTEMPTS ||
        !isRetryableCanvaUploadError(error)
      ) {
        break;
      }

      await wait(CANVA_UPLOAD_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Please try again.");
};

const addAssetToDesign = async (asset: GenerationAsset) => {
  if (asset.type === "image") {
    const queuedImageRef = await uploadAssetToCanva(asset);
    if (!queuedImageRef) {
      return;
    }

    await addElementAtPoint({
      type: "image",
      ref: queuedImageRef,
      altText: {
        text: asset.label,
        decorative: false,
      },
    });
    return;
  }

  if (asset.type === "video") {
    const queuedVideo = await upload({
      type: "video",
      name: asset.label,
      mimeType: inferVideoMimeType(asset),
      url: asset.url,
      thumbnailImageUrl: asset.thumbnailUrl || asset.url,
      aiDisclosure: "app_generated",
    });

    await addElementAtPoint({
      type: "video",
      ref: queuedVideo.ref,
      altText: {
        text: asset.label,
        decorative: false,
      },
    });
  }
};

const addImageAssetsToDesign = async (assets: GenerationAsset[]) => {
  if (!assets.length) {
    return;
  }

  const pageContext = await getCurrentPageContext();

  if (!pageContext.dimensions) {
    for (const [index, asset] of assets.entries()) {
      try {
        await addImageAssetToDesignWithRetry(asset);
      } catch (error) {
        throw new Error(
          `Unable to add generated image ${index + 1} to Canva. ${getErrorMessage(
            error,
          )}`,
        );
      }
    }
    return;
  }

  const placements = getGeneratedImagePlacements(
    assets,
    pageContext.dimensions,
  );

  for (const [index, asset] of assets.entries()) {
    try {
      await addImageAssetToDesignWithRetry(asset, placements[index]);
    } catch (error) {
      throw new Error(
        `Unable to add generated image ${index + 1} to Canva. ${getErrorMessage(
          error,
        )}`,
      );
    }
  }
};

const AssetCard = ({
  asset,
  onAdd,
  onDownload,
}: {
  asset: GenerationAsset;
  onAdd: (asset: GenerationAsset) => Promise<void>;
  onDownload: (asset: GenerationAsset) => Promise<void>;
}) => {
  const [isWorking, setIsWorking] = useState(false);

  const handleAdd = async () => {
    setIsWorking(true);
    try {
      await onAdd(asset);
    } finally {
      setIsWorking(false);
    }
  };

  const handleDownload = async () => {
    setIsWorking(true);
    try {
      await onDownload(asset);
    } finally {
      setIsWorking(false);
    }
  };

  if (asset.type === "video") {
    const videoMimeType = inferVideoCardMimeType(asset);

    return (
      <Rows spacing="1u">
        {videoMimeType === "image/gif" ? (
          <VideoCard
            thumbnailUrl={asset.thumbnailUrl}
            mimeType="image/gif"
            alt={asset.label}
            ariaLabel="Add video to design"
            borderRadius="standard"
            thumbnailHeight={168}
            onClick={handleAdd}
          />
        ) : (
          <VideoCard
            thumbnailUrl={asset.thumbnailUrl}
            videoPreviewUrl={asset.url}
            mimeType={videoMimeType}
            ariaLabel="Add video to design"
            borderRadius="standard"
            thumbnailHeight={168}
            onClick={handleAdd}
          />
        )}
        <Rows spacing="0.5u">
          <Text size="small" variant="bold">
            {asset.label}
          </Text>
          <Button variant="secondary" onClick={handleAdd} loading={isWorking}>
            Add to design
          </Button>
          <Button variant="tertiary" onClick={handleDownload}>
            Download
          </Button>
        </Rows>
      </Rows>
    );
  }

  if (asset.type === "3d") {
    return (
      <Rows spacing="1u">
        <HorizontalCard
          title={asset.label}
          description="3D asset"
          thumbnail={{
            url: asset.thumbnailUrl || asset.url,
            alt: asset.label,
          }}
        />
        <Button
          variant="secondary"
          onClick={handleDownload}
          loading={isWorking}
        >
          Download
        </Button>
      </Rows>
    );
  }

  return (
    <Rows spacing="1u">
      <ImageCard
        thumbnailUrl={asset.thumbnailUrl || asset.url}
        alt={asset.label}
        ariaLabel="Add image to design"
        borderRadius="standard"
        thumbnailHeight={168}
        onClick={handleAdd}
      />
      <Rows spacing="0.5u">
        <Text size="small" variant="bold">
          {asset.label}
        </Text>
        <Button variant="secondary" onClick={handleAdd} loading={isWorking}>
          Add to design
        </Button>
        <Button variant="tertiary" onClick={handleDownload}>
          Download
        </Button>
      </Rows>
    </Rows>
  );
};

const LibraryImageCard = ({
  asset,
  aspectRatio,
  onAdd,
  onDownload,
  onBroken,
}: {
  asset: GenerationAsset;
  onAdd: (asset: GenerationAsset) => Promise<void>;
  onDownload: (asset: GenerationAsset) => Promise<void>;
  onBroken: (assetId: string) => void;
  aspectRatio: number;
}) => {
  const [workingAction, setWorkingAction] = useState<"add" | "download" | null>(
    null,
  );
  const [isBroken, setIsBroken] = useState(false);

  const handleAdd = async () => {
    setWorkingAction("add");
    try {
      await onAdd(asset);
    } finally {
      setWorkingAction(null);
    }
  };

  const handleDownload = async () => {
    setWorkingAction("download");
    try {
      await onDownload(asset);
    } finally {
      setWorkingAction(null);
    }
  };

  if (isBroken) {
    return null;
  }

  return (
    <Rows spacing="0.5u">
      <div className={styles.libraryAssetPreview}>
        <ImageCard
          thumbnailUrl={asset.thumbnailUrl || asset.url}
          alt={asset.label}
          ariaLabel="Add image to design"
          borderRadius="standard"
          thumbnailAspectRatio={aspectRatio}
          onClick={handleAdd}
          onImageLoad={(loadingState) => {
            if (loadingState === "error") {
              setIsBroken(true);
              onBroken(asset.id);
            }
          }}
        />
        <div className={styles.libraryAssetActions}>
          <Button
            variant="secondary"
            icon={PlusIcon}
            ariaLabel={`Add ${asset.label} to design`}
            loading={workingAction === "add"}
            onClick={handleAdd}
          />
          <Button
            variant="secondary"
            icon={ArrowDownIcon}
            ariaLabel={`Download ${asset.label}`}
            loading={workingAction === "download"}
            onClick={handleDownload}
          />
        </div>
      </div>
    </Rows>
  );
};

type AppButtonProps = ComponentProps<typeof Button>;
const DestructiveButton = Button as unknown as (
  props: Omit<AppButtonProps, "variant"> & {
    variant?: AppButtonProps["variant"] | "critical";
  },
) => ReturnType<typeof Button>;

const KeySetupPanel = ({
  title,
  description,
  instructions,
  apiKeyInput,
  savedApiKey,
  onApiKeyInputChange,
  onSubmit,
  onRemove,
  isBusy,
  verificationError,
  showRemove,
}: {
  title: string;
  description: string;
  instructions?: ReactNode;
  apiKeyInput: string;
  savedApiKey?: string | null;
  onApiKeyInputChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  onRemove?: () => void;
  isBusy: boolean;
  verificationError: string;
  showRemove: boolean;
}) => (
  <Rows spacing="2u">
    {title.trim() || description.trim() ? (
      <Rows spacing="0.5u">
        {title.trim() ? <Text variant="bold">{title}</Text> : null}
        {description.trim() ? <Text size="small">{description}</Text> : null}
      </Rows>
    ) : null}
    {instructions ? <Rows spacing="0.5u">{instructions}</Rows> : null}
    {verificationError ? (
      <Alert tone="critical" title="Verification failed">
        {verificationError}
      </Alert>
    ) : null}
    {savedApiKey ? (
      <div className={styles.savedKeyCard}>
        <div className={styles.savedKeyInlineRow}>
          <div className={styles.savedKeyInputWrap}>
            <TextInput disabled={true} value={maskApiKey(savedApiKey)} />
          </div>
          {showRemove && onRemove ? (
            <Button
              variant="secondary"
              icon={TrashIcon}
              ariaLabel="Remove key"
              tooltipLabel="Remove key"
              onClick={onRemove}
            />
          ) : null}
        </div>
      </div>
    ) : null}
    {!savedApiKey ? (
      <>
        <FormField
          label="IMAI.Studio API key"
          value={apiKeyInput}
          control={(props) => (
            <TextInput
              {...props}
              placeholder="sk_live_..."
              onChange={onApiKeyInputChange}
            />
          )}
        />
        <Button variant="primary" onClick={onSubmit} loading={isBusy}>
          Next
        </Button>
      </>
    ) : null}
    {!savedApiKey && showRemove && onRemove ? (
      <DestructiveButton variant="critical" onClick={onRemove} icon={TrashIcon}>
        Remove key
      </DestructiveButton>
    ) : null}
  </Rows>
);

const ConnectedSettingsView = ({
  savedApiKey,
  onBack,
  onRemove,
}: {
  savedApiKey: string;
  onBack: () => void;
  onRemove: () => void;
}) => {
  const handleContactSupport = async () => {
    await requestOpenExternalUrl({
      url: `mailto:${SUPPORT_EMAIL}`,
    });
  };

  return (
    <div className={styles.settingsPanel}>
      <Rows spacing="1.5u">
        <Rows spacing="0.5u">
          <Text variant="bold">API key</Text>
          <div className={styles.savedKeyInlineRow}>
            <div className={styles.savedKeyInputWrap}>
              <TextInput disabled={true} value={maskApiKey(savedApiKey)} />
            </div>
            <Button
              variant="secondary"
              icon={TrashIcon}
              ariaLabel="Remove key"
              tooltipLabel="Remove key"
              onClick={onRemove}
            />
          </div>
        </Rows>

        <div className={styles.settingsInfoCard}>
          <Rows spacing="1u">
            <Text variant="bold">FAQ</Text>
            {SETTINGS_FAQS.map((item, index) => (
              <div key={item.question} className={styles.settingsInfoItem}>
                <Text variant="bold" size="small">
                  {index + 1}. {item.question}
                </Text>
                <div className={styles.settingsInfoAnswer}>
                  <Text size="small" tone="secondary">
                    {item.answer}
                  </Text>
                </div>
              </div>
            ))}
          </Rows>
        </div>

        <div className={styles.settingsInfoCard}>
          <Rows spacing="1u">
            <Text variant="bold">Help</Text>
            <Text size="small" tone="secondary">
              Contact us at {SUPPORT_EMAIL}
            </Text>
            <Button
              variant="secondary"
              onClick={handleContactSupport}
              stretch={true}
            >
              Contact support
            </Button>
          </Rows>
        </div>

        <div className={styles.settingsButtonStack}>
          <Button variant="primary" onClick={onBack} stretch={true}>
            Go back
          </Button>
        </div>
      </Rows>
    </div>
  );
};

const CreditsRemainingInline = ({
  credits,
}: {
  credits: CreditBalance | null;
}) => {
  if (!credits) {
    return null;
  }

  const roundedBalance = Math.round(credits.balance);

  return (
    <div className={styles.creditsInline}>
      <Text size="small" variant="bold" alignment="center">
        Credits remaining: {roundedBalance}
      </Text>
    </div>
  );
};

const renderShowcaseDescription = (description: string) => {
  const lines = description
    .split(SHOWCASE_DESCRIPTION_BREAK_PATTERN)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return null;
  }

  return (
    <div className={styles.showcaseDescription}>
      <Text size="small">
        {lines.map((line, index) => (
          <span key={`${line}-${index}`}>
            {index > 0 ? <br /> : null}
            {line}
          </span>
        ))}
      </Text>
    </div>
  );
};

const ShowcaseCarouselCard = ({
  title,
  description,
  thumbnailUrl,
}: ShowcaseCard) => (
  <div className={styles.showcaseSlide} role="group" aria-label={title}>
    <div className={styles.showcaseVisual}>
      <ImageCard
        alt=""
        thumbnailUrl={thumbnailUrl}
        thumbnailHeight={160}
        borderRadius="none"
      />
    </div>
    <div className={styles.showcaseCopy}>
      <div className={styles.showcaseTitle}>
        <Text variant="bold">{title}</Text>
      </div>
      {renderShowcaseDescription(description)}
    </div>
  </div>
);

const GenerationPanel = ({
  source,
  uploadBusy,
  uploadError,
  prompt,
  promptPlaceholder,
  promptLabel,
  imageCount,
  onImageCountChange,
  onPromptChange,
  onRemoveSource,
  onFileChange,
  onFileReject,
  actionLabel,
  actionBusy,
  onGenerate,
  credits,
  showcaseCards,
  details,
}: GenerationPanelProps) => {
  const canGenerate =
    Boolean(source?.previewUrl) && prompt.trim().length > 0 && !uploadBusy;

  return (
    <div className={`${styles.sectionShell} ${styles.generationSectionShell}`}>
      <Rows spacing="2u">
        <div className={styles.generationFormShell}>
          <Rows spacing="1.5u">
            <FormField
              label={promptLabel}
              value={prompt}
              control={(props) => (
                <MultilineInput
                  {...props}
                  minRows={PROMPT_MIN_ROWS}
                  placeholder={promptPlaceholder}
                  onChange={onPromptChange}
                />
              )}
            />

            {typeof imageCount === "number" && onImageCountChange ? (
              <FormField
                label={`Generate: ${imageCount} image${imageCount === 1 ? "" : "s"}`}
                value={imageCount}
                control={() => (
                  <div className={styles.imageCountSlider}>
                    <Slider
                      value={imageCount}
                      max={MAX_MARKETING_IMAGE_COUNT}
                      min={MIN_MARKETING_IMAGE_COUNT}
                      step={1}
                      onChange={(value) =>
                        onImageCountChange(Math.round(value))
                      }
                    />
                  </div>
                )}
              />
            ) : null}

            <div className={styles.primaryActionButton}>
              <FileInput
                accept={["image/*"]}
                disabled={uploadBusy}
                stretchButton
                onDropAcceptedFiles={(files) => {
                  void onFileChange(files[0] ?? null);
                }}
                onDropRejectedFiles={onFileReject}
              />
            </div>

            <div className={styles.primaryActionButton}>
              <Button
                variant="primary"
                onClick={onGenerate}
                loading={actionBusy}
                disabled={!canGenerate}
                stretch={true}
              >
                {actionLabel}
              </Button>
            </div>

            {uploadBusy ? (
              <Rows spacing="1u">
                <Title size="xsmall">Uploading source image</Title>
                <ProgressBar ariaLabel="Uploading source image" value={50} />
              </Rows>
            ) : null}

            {uploadError ? (
              <Alert tone="critical" title="Upload failed">
                {uploadError}
              </Alert>
            ) : null}

            {source ? (
              <Rows spacing="1u">
                <FileInputItem
                  label={source.fileName}
                  disabled={uploadBusy}
                  onDeleteClick={onRemoveSource}
                />
                <div className={styles.sourcePreviewCard}>
                  <ImageCard
                    thumbnailUrl={source.localPreviewUrl}
                    alt="Uploaded source"
                    borderRadius="standard"
                    thumbnailHeight={160}
                  />
                </div>
              </Rows>
            ) : null}

            <CreditsRemainingInline credits={credits} />

            <Carousel>
              {showcaseCards.map((card) => (
                <ShowcaseCarouselCard key={card.title} {...card} />
              ))}
            </Carousel>

            {details ? <EcommerceDetailsSection details={details} /> : null}
          </Rows>
        </div>
      </Rows>
    </div>
  );
};

const EcommerceDetailsSection = ({
  details,
}: {
  details: EcommerceDetailsView | null;
}) => {
  if (!details) {
    return null;
  }

  return (
    <Rows spacing="1u">
      <Text variant="bold">Catalogue details</Text>
      {details.title ? (
        <div className={styles.detailCard}>
          <Text size="small">Title</Text>
          <Text>{details.title}</Text>
        </div>
      ) : null}
      {details.description ? (
        <div className={styles.detailCard}>
          <Text size="small">Description</Text>
          <Text>{details.description}</Text>
        </div>
      ) : null}
      {details.features.length ? (
        <div className={styles.detailCard}>
          <Text size="small">Features</Text>
          <ul className={styles.detailList}>
            {details.features.map((feature) => (
              <li key={feature}>
                <Text>{feature}</Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {Object.keys(details.specifications).length ? (
        <div className={styles.detailCard}>
          <Text size="small">Specifications</Text>
          <dl className={styles.specList}>
            {Object.entries(details.specifications).map(([key, value]) => (
              <div key={key} className={styles.specRow}>
                <dt>
                  <Text variant="bold">{key}</Text>
                </dt>
                <dd>
                  <Text>{value}</Text>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </Rows>
  );
};

const AppErrorFallback = () => (
  <Alert tone="critical" title="App error">
    Something went wrong while rendering IMAI.Studio.
  </Alert>
);

export const StudioApp = () => {
  const [stage, setStage] = useState<AppStage>("booting");
  const [activeTab, setActiveTab] = useState<ContentTab>("media");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [generationState, setGenerationState] =
    useState<GenerationState>("idle");
  const [generationMessage, setGenerationMessage] = useState("");
  const [sourceImportTab, setSourceImportTab] = useState<ContentTab | null>(
    null,
  );
  const [mediaUploadError, setMediaUploadError] = useState("");
  const [catalogueUploadError, setCatalogueUploadError] = useState("");
  const [mediaPrompt, setMediaPrompt] = useState("");
  const [mediaImageCount, setMediaImageCount] = useState(
    MIN_MARKETING_IMAGE_COUNT,
  );
  const [mediaSource, setMediaSource] = useState<UploadedSource | null>(null);
  const [cataloguePrompt, setCataloguePrompt] = useState("");
  const [catalogueSource, setCatalogueSource] = useState<UploadedSource | null>(
    null,
  );
  const [catalogueDetails, setCatalogueDetails] =
    useState<EcommerceDetailsView | null>(null);
  const [libraryAssets, setLibraryAssets] = useState<GenerationAsset[]>([]);
  const [libraryCursor, setLibraryCursor] = useState<string | null>(null);
  const [libraryHasMore, setLibraryHasMore] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const libraryLoadingRef = useRef(false);

  const isVerifying = stage === "verifying";
  const isCompactPanelView =
    (stage === "setup" || stage === "verifying") && !apiKey ? true : false;

  useEffect(() => {
    libraryLoadingRef.current = libraryLoading;
  }, [libraryLoading]);

  useEffect(() => {
    return () => {
      if (mediaSource?.localPreviewUrl) {
        URL.revokeObjectURL(mediaSource.localPreviewUrl);
      }
      if (catalogueSource?.localPreviewUrl) {
        URL.revokeObjectURL(catalogueSource.localPreviewUrl);
      }
    };
  }, [catalogueSource?.localPreviewUrl, mediaSource?.localPreviewUrl]);

  const clearSource = (targetTab: "media" | "catalogue") => {
    if (targetTab === "media") {
      setMediaUploadError("");
      revokeSourcePreviewUrl(mediaSource);
      setMediaSource(null);
      return;
    }

    setCatalogueUploadError("");
    revokeSourcePreviewUrl(catalogueSource);
    setCatalogueSource(null);
  };

  useEffect(() => {
    let isMounted = true;

    const initializeApp = async () => {
      const storedApiKey = await getStoredApiKey();
      if (!isMounted) {
        return;
      }

      if (storedApiKey) {
        setApiKey(storedApiKey);
        setStage("verifying");
        setVerificationError("");
        try {
          const verification = await verifyApiKey(storedApiKey, {
            libraryNumItems: INITIAL_LIBRARY_PAGE_SIZE,
          });
          if (!isMounted) {
            return;
          }

          setCredits(verification.credits);
          setLibraryAssets(
            mapLibraryResponse(verification.library).filter(
              (asset) => asset.type === "image",
            ),
          );
          setLibraryHasMore(verification.library.pagination.hasMore);
          setLibraryCursor(verification.library.pagination.nextCursor);
          setStage("ready");
          return;
        } catch (error) {
          if (!isMounted) {
            return;
          }

          setVerificationError(
            error instanceof Error
              ? error.message
              : "Unable to verify API key.",
          );
          removeStoredApiKey();
          setApiKey(null);
          setStage("setup");
          return;
        }
      }

      setStage(getHasSeenSetup() ? "setup" : "showcase");
    };

    void initializeApp();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (stage !== "ready" || activeTab !== "library" || !apiKey) {
      return;
    }

    if (libraryAssets.length || libraryLoading) {
      return;
    }

    void refreshLibrary();
  }, [activeTab, apiKey, libraryAssets.length, libraryLoading, stage]);

  useEffect(() => {
    if (stage !== "ready" || !apiKey) {
      return;
    }

    if (libraryAssets.length > 0) {
      return;
    }

    void refreshLibrary();
  }, [apiKey, libraryAssets.length, stage]);

  useEffect(() => {
    if (stage !== "ready" || activeTab !== "library" || !libraryHasMore) {
      return;
    }

    const container = scrollContainerRef.current;
    if (!container || libraryLoadingRef.current) {
      return;
    }

    const remainingScrollDistance =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    if (remainingScrollDistance <= LIBRARY_SCROLL_THRESHOLD_PX) {
      void loadMoreLibraryAssets();
    }
  }, [activeTab, libraryAssets.length, libraryHasMore, stage]);

  const refreshLibrary = async () => {
    if (!apiKey) {
      return;
    }

    setLibraryLoading(true);
    setLibraryError("");
    try {
      const response = await getMarketingLibrary(apiKey, {
        numItems: INITIAL_LIBRARY_PAGE_SIZE,
        type: "image",
      });

      setLibraryAssets(
        mapLibraryResponse(response).filter((asset) => asset.type === "image"),
      );
      setLibraryHasMore(response.pagination.hasMore);
      setLibraryCursor(response.pagination.nextCursor);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "Unable to load the library.",
      );
    } finally {
      setLibraryLoading(false);
    }
  };

  const loadMoreLibraryAssets = async () => {
    if (!apiKey || !libraryCursor || libraryLoadingRef.current) {
      return;
    }

    libraryLoadingRef.current = true;
    setLibraryLoading(true);
    setLibraryError("");
    try {
      const response = await getMarketingLibrary(apiKey, {
        cursor: libraryCursor,
        numItems: LIBRARY_PAGE_SIZE,
        type: "image",
      });

      setLibraryAssets((currentAssets) =>
        mergeAssetsById(
          currentAssets,
          mapLibraryResponse(response).filter(
            (asset) => asset.type === "image",
          ),
        ),
      );
      setLibraryHasMore(response.pagination.hasMore);
      setLibraryCursor(response.pagination.nextCursor);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "Unable to load more assets.",
      );
    } finally {
      libraryLoadingRef.current = false;
      setLibraryLoading(false);
    }
  };

  const handleLibraryScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!libraryHasMore || libraryLoadingRef.current) {
      return;
    }

    const container = event.currentTarget;
    const remainingScrollDistance =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    if (remainingScrollDistance <= LIBRARY_SCROLL_THRESHOLD_PX) {
      void loadMoreLibraryAssets();
    }
  };

  const handleTabSelect = (nextId: string) => {
    setActiveTab(nextId as ContentTab);
  };

  const handleVerifyApiKey = async () => {
    if (!apiKeyInput.trim()) {
      setVerificationError("Enter a valid IMAI.Studio API key first.");
      return;
    }

    setStage("verifying");
    setVerificationError("");
    try {
      const verification = await verifyApiKey(apiKeyInput.trim(), {
        libraryNumItems: INITIAL_LIBRARY_PAGE_SIZE,
      });
      await setStoredApiKey(apiKeyInput.trim());
      setApiKey(apiKeyInput.trim());
      setCredits(verification.credits);
      setLibraryAssets(
        mapLibraryResponse(verification.library).filter(
          (asset) => asset.type === "image",
        ),
      );
      setLibraryHasMore(verification.library.pagination.hasMore);
      setLibraryCursor(verification.library.pagination.nextCursor);
      setApiKeyInput("");
      setStage("ready");
    } catch (error) {
      setVerificationError(
        error instanceof Error ? error.message : "Unable to verify API key.",
      );
      setStage("setup");
    }
  };

  const handleRemoveApiKey = () => {
    removeStoredApiKey();
    setApiKey(null);
    setApiKeyInput("");
    setCredits(null);
    setLibraryAssets([]);
    setLibraryCursor(null);
    setLibraryHasMore(false);
    setSourceImportTab(null);
    setMediaUploadError("");
    setCatalogueUploadError("");
    revokeSourcePreviewUrl(mediaSource);
    revokeSourcePreviewUrl(catalogueSource);
    setMediaSource(null);
    setCatalogueSource(null);
    setCatalogueDetails(null);
    setStage("setup");
  };

  const handleSourceFileSelection = async (
    targetTab: "media" | "catalogue",
    file: File | null,
  ) => {
    if (!file) {
      return;
    }

    if (targetTab === "media") {
      setMediaUploadError("");
    } else {
      setCatalogueUploadError("");
    }

    setSourceImportTab(targetTab);

    try {
      const tempfileUpload = await uploadFileToTempfile(file, {
        expiryHours: 24,
      });

      const nextSource: UploadedSource = {
        tempfileFileId: tempfileUpload.fileId,
        tempfileFileUrl: tempfileUpload.fileUrl,
        previewUrl: tempfileUpload.previewUrl,
        expiryTime: tempfileUpload.expiryTime,
        localPreviewUrl: URL.createObjectURL(file),
        fileName: file.name,
      };

      if (targetTab === "media") {
        revokeSourcePreviewUrl(mediaSource);
        setMediaSource(nextSource);
      } else {
        revokeSourcePreviewUrl(catalogueSource);
        setCatalogueSource(nextSource);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to upload the selected file.";

      if (targetTab === "media") {
        setMediaUploadError(message);
      } else {
        setCatalogueUploadError(message);
      }
    } finally {
      setSourceImportTab(null);
    }
  };

  const handleSourceFileRejection = (targetTab: "media" | "catalogue") => {
    const message = "Select a valid image file.";

    if (targetTab === "media") {
      setMediaUploadError(message);
      return;
    }

    setCatalogueUploadError(message);
  };

  const handleBrokenLibraryAsset = (assetId: string) => {
    setLibraryAssets((currentAssets) =>
      currentAssets.filter((asset) => asset.id !== assetId),
    );
  };

  const pollUntilCompleted = (jobId: string) =>
    pollGenerationJobUntilCompleted({
      jobId,
      getStatus: (nextJobId) =>
        getGenerationStatus(apiKey as string, nextJobId),
    });

  const syncCredits = async () => {
    if (!apiKey) {
      return;
    }

    try {
      const latestCredits = await getCredits(apiKey);
      setCredits(latestCredits);
    } catch {
      // Ignore a credit refresh failure and keep the existing snapshot.
    }
  };

  const extractEcommerceDetails = (
    result: EcommerceGenerationResponse,
  ): EcommerceDetailsView | null => {
    if (!result.details) {
      return null;
    }

    const genericPlatform = result.details.platforms?.generic;
    return {
      title: result.details.title || genericPlatform?.title,
      description: result.details.description || genericPlatform?.description,
      features: result.details.features || genericPlatform?.bulletPoints || [],
      specifications: result.details.specifications || {},
    };
  };

  const runJob = async (
    runner: () => Promise<GenerationJobResult>,
    onCompleted: (result: GenerationJobResult) => Promise<void>,
  ) => {
    if (!apiKey) {
      return;
    }

    setGenerationState("submitting");
    setGenerationMessage("");

    try {
      const initialResponse = await runner();
      const initialCompletedResult = getCompletedJobResult(initialResponse);

      if (initialCompletedResult) {
        await onCompleted(initialCompletedResult);
      } else if (initialResponse.accepted && initialResponse.jobId) {
        setGenerationState("polling");

        const statusResponse = await pollUntilCompleted(initialResponse.jobId);
        const completedResult = getCompletedJobResult(statusResponse);

        if (!completedResult) {
          throw new Error("Generation completed without a result payload.");
        }

        await onCompleted(completedResult);
      } else {
        await onCompleted(initialResponse);
      }

      await syncCredits();
    } catch (error) {
      setGenerationMessage(
        error instanceof Error ? error.message : "Generation failed.",
      );
    } finally {
      setGenerationState("idle");
    }
  };

  const handleMediaGeneration = async () => {
    if (!apiKey) {
      return;
    }

    if (!mediaSource?.previewUrl) {
      setGenerationMessage(
        "Import a selected Canva image before generating marketing assets.",
      );
      return;
    }

    await runJob(
      () =>
        startMarketingGeneration(apiKey, {
          url: mediaSource.previewUrl,
          prompt: buildMarketingPrompt(mediaPrompt, mediaImageCount),
        }),
      async (result) => {
        const assets = mapMarketingResultToAssets(
          result as MarketingGenerationResponse,
        );
        await addImageAssetsToDesign(assets);
      },
    );
  };

  const handleCatalogueGeneration = async () => {
    if (!apiKey) {
      return;
    }

    if (!catalogueSource?.previewUrl) {
      setGenerationMessage(
        "Import a selected Canva image before generating catalogue data.",
      );
      return;
    }

    await runJob(
      () =>
        startEcommerceGeneration(apiKey, {
          url: catalogueSource.previewUrl,
          prompt: cataloguePrompt.trim() || undefined,
        }),
      async (result) => {
        const ecommerceResult = result as EcommerceGenerationResponse;
        const assets = mapEcommerceResultToAssets(ecommerceResult);
        setCatalogueDetails(extractEcommerceDetails(ecommerceResult));
        await addImageAssetsToDesign(assets);
      },
    );
  };

  return (
    <ErrorBoundary fallback={<AppErrorFallback />}>
      <div
        ref={scrollContainerRef}
        className={`${styles.scrollContainer} ${isCompactPanelView ? styles.scrollContainerLocked : ""}`}
        onScroll={handleLibraryScroll}
      >
        <Rows spacing="2u">
          <SurfaceHeader
            title="IMAI.Studio"
            description="AI agents that create product shots and marketing visuals"
            end={
              stage === "ready" && apiKey ? (
                <Button
                  variant="tertiary"
                  size="small"
                  icon={CogIcon}
                  ariaLabel={
                    isSettingsOpen ? "Close settings" : "Open settings"
                  }
                  tooltipLabel={
                    isSettingsOpen ? "Close settings" : "Open settings"
                  }
                  onClick={() => setIsSettingsOpen((current) => !current)}
                />
              ) : undefined
            }
          />

          {stage === "booting" ? (
            <Rows spacing="1u">
              <Text variant="bold">Loading IMAI.Studio...</Text>
              <Text size="small">
                Restoring saved configuration and verifying your API key.
              </Text>
            </Rows>
          ) : null}

          {stage === "showcase" ? (
            <Rows spacing="2u">
              <Rows spacing="0.5u">
                <Text variant="bold">Preview the workflow first</Text>
                <Text size="small">
                  These slides are placeholders for your showcase URLs. Once an
                  API key is verified, this onboarding screen stays hidden.
                </Text>
              </Rows>
              <Carousel>
                <EmbedCard
                  ariaLabel="Add embed to design"
                  description="Puppyhood"
                  onClick={() => {}}
                  thumbnailUrl="https://www.canva.dev/example-assets/images/puppyhood.jpg"
                  title="Heartwarming Chatter: Adorable Conversation with a puppy"
                />
                <EmbedCard
                  ariaLabel="Add embed to design"
                  description="Puppyhood"
                  onClick={() => {}}
                  thumbnailUrl="https://www.canva.dev/example-assets/images/puppyhood.jpg"
                  title="Heartwarming Chatter: Adorable Conversation with a puppy"
                />
                <EmbedCard
                  ariaLabel="Add embed to design"
                  description="Puppyhood"
                  onClick={() => {}}
                  thumbnailUrl="https://www.canva.dev/example-assets/images/puppyhood.jpg"
                  title="Heartwarming Chatter: Adorable Conversation with a puppy"
                />
                <EmbedCard
                  ariaLabel="Add embed to design"
                  description="Puppyhood"
                  onClick={() => {}}
                  thumbnailUrl="https://www.canva.dev/example-assets/images/puppyhood.jpg"
                  title="Heartwarming Chatter: Adorable Conversation with a puppy"
                />
              </Carousel>
              <Button variant="primary" onClick={() => setStage("setup")}>
                Get started
              </Button>
            </Rows>
          ) : null}

          {(stage === "setup" || stage === "verifying") && !apiKey ? (
            <div className={styles.stageCenter}>
              <div className={styles.stageCenterInner}>
                <KeySetupPanel
                  title="Get Started"
                  description=""
                  instructions={
                    <>
                      <Text alignment="start" size="medium">
                        1. Log in to IMAI.Studio
                      </Text>
                      <Text alignment="start" size="medium">
                        2. Go to Extensions
                      </Text>
                      <Text alignment="start" size="medium">
                        3. Select Canva
                      </Text>
                      <Text alignment="start" size="medium">
                        4. Copy your API key
                      </Text>
                    </>
                  }
                  apiKeyInput={apiKeyInput}
                  savedApiKey={null}
                  onApiKeyInputChange={setApiKeyInput}
                  onSubmit={handleVerifyApiKey}
                  isBusy={isVerifying}
                  verificationError={verificationError}
                  showRemove={false}
                />
              </div>
            </div>
          ) : null}

          {stage === "ready" && apiKey ? (
            <Rows spacing="2u">
              {generationMessage ? (
                <Alert tone="critical" title="Generation failed">
                  {generationMessage}
                </Alert>
              ) : null}
              {isSettingsOpen ? (
                <div className={styles.settingsStage}>
                  {apiKey ? (
                    <ConnectedSettingsView
                      savedApiKey={apiKey}
                      onBack={() => setIsSettingsOpen(false)}
                      onRemove={handleRemoveApiKey}
                    />
                  ) : (
                    <KeySetupPanel
                      title=""
                      description=""
                      apiKeyInput={apiKeyInput}
                      savedApiKey={null}
                      onApiKeyInputChange={setApiKeyInput}
                      onSubmit={handleVerifyApiKey}
                      onRemove={handleRemoveApiKey}
                      isBusy={isVerifying}
                      verificationError={verificationError}
                      showRemove={true}
                    />
                  )}
                </div>
              ) : (
                <Tabs
                  activeId={activeTab}
                  onSelect={(nextId) => handleTabSelect(nextId)}
                >
                  <div className={styles.tabSwitcher}>
                    <TabList align="stretch">
                      <Tab
                        id="media"
                        active={activeTab === "media"}
                        onClick={handleTabSelect}
                      >
                        Marketing
                      </Tab>
                      <Tab
                        id="catalogue"
                        active={activeTab === "catalogue"}
                        onClick={handleTabSelect}
                      >
                        Catalogue
                      </Tab>
                      <Tab
                        id="library"
                        active={activeTab === "library"}
                        onClick={handleTabSelect}
                      >
                        Library
                      </Tab>
                    </TabList>
                  </div>
                  <TabPanels>
                    <TabPanel id="media" active={activeTab === "media"}>
                      <GenerationPanel
                        source={mediaSource}
                        uploadBusy={sourceImportTab === "media"}
                        uploadError={mediaUploadError}
                        prompt={mediaPrompt}
                        promptPlaceholder="Generate 4 listing shots and 2 lifestyle images"
                        promptLabel="Prompt"
                        imageCount={mediaImageCount}
                        onImageCountChange={setMediaImageCount}
                        onPromptChange={setMediaPrompt}
                        onRemoveSource={() => clearSource("media")}
                        onFileChange={(file) =>
                          handleSourceFileSelection("media", file)
                        }
                        onFileReject={() => handleSourceFileRejection("media")}
                        actionLabel="Generate"
                        actionBusy={generationState !== "idle"}
                        onGenerate={handleMediaGeneration}
                        credits={credits}
                        showcaseCards={MEDIA_SHOWCASE_CARDS}
                      />
                    </TabPanel>
                    <TabPanel id="catalogue" active={activeTab === "catalogue"}>
                      <GenerationPanel
                        source={catalogueSource}
                        uploadBusy={sourceImportTab === "catalogue"}
                        uploadError={catalogueUploadError}
                        prompt={cataloguePrompt}
                        promptPlaceholder="Focus on premium materials and ecommerce-ready copy"
                        promptLabel="Prompt"
                        onPromptChange={setCataloguePrompt}
                        onRemoveSource={() => clearSource("catalogue")}
                        onFileChange={(file) =>
                          handleSourceFileSelection("catalogue", file)
                        }
                        onFileReject={() =>
                          handleSourceFileRejection("catalogue")
                        }
                        actionLabel="Generate"
                        actionBusy={generationState !== "idle"}
                        onGenerate={handleCatalogueGeneration}
                        credits={credits}
                        showcaseCards={CATALOGUE_SHOWCASE_CARDS}
                        details={catalogueDetails}
                      />
                    </TabPanel>
                    <TabPanel id="library" active={activeTab === "library"}>
                      <div className={styles.sectionShell}>
                        <Rows spacing="2u">
                          {libraryError ? (
                            <Alert tone="critical" title="Library error">
                              {libraryError}
                            </Alert>
                          ) : null}

                          {libraryLoading && !libraryAssets.length ? (
                            <Rows spacing="1u">
                              <Text variant="bold">Loading library...</Text>
                              <Text size="small">
                                Pulling your marketing generations from
                                IMAI.Studio.
                              </Text>
                            </Rows>
                          ) : null}

                          {!libraryLoading && !libraryAssets.length ? (
                            <HorizontalCard
                              title="No library assets yet"
                              description="Once marketing generations are created, they will appear here."
                              thumbnail={{ icon: SearchIcon }}
                            />
                          ) : null}

                          {libraryAssets.length ? (
                            <div className={styles.libraryGallery}>
                              <Masonry targetRowHeightPx={180}>
                                {libraryAssets.map((asset) => {
                                  const dimensions =
                                    getLibraryAssetDimensions(asset);

                                  return asset.type === "image" ? (
                                    <MasonryItem
                                      key={asset.id}
                                      targetHeightPx={dimensions.targetHeightPx}
                                      targetWidthPx={dimensions.targetWidthPx}
                                    >
                                      <LibraryImageCard
                                        asset={asset}
                                        aspectRatio={dimensions.aspectRatio}
                                        onAdd={addAssetToDesign}
                                        onDownload={openExternalUrlAsset}
                                        onBroken={handleBrokenLibraryAsset}
                                      />
                                    </MasonryItem>
                                  ) : (
                                    <MasonryItem
                                      key={asset.id}
                                      targetHeightPx={dimensions.targetHeightPx}
                                      targetWidthPx={dimensions.targetWidthPx}
                                    >
                                      <AssetCard
                                        asset={asset}
                                        onAdd={addAssetToDesign}
                                        onDownload={openExternalUrlAsset}
                                      />
                                    </MasonryItem>
                                  );
                                })}
                              </Masonry>
                            </div>
                          ) : null}

                          {libraryLoading && libraryAssets.length ? (
                            <Text size="small">Loading more assets...</Text>
                          ) : null}
                        </Rows>
                      </div>
                    </TabPanel>
                  </TabPanels>
                </Tabs>
              )}
            </Rows>
          ) : null}
        </Rows>
      </div>
    </ErrorBoundary>
  );
};
