import {
  Alert,
  Button,
  Carousel,
  CogIcon,
  EmbedCard,
  FileInput,
  FileInputItem,
  FormField,
  Grid,
  HorizontalCard,
  ImageIcon,
  ImageCard,
  Masonry,
  MasonryItem,
  ProgressBar,
  Rows,
  SearchIcon,
  PlusIcon,
  ArrowDownIcon,
  MultilineInput,
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
import {
  upload,
  type ImageMimeType,
  type VideoMimeType,
} from "@canva/asset";
import { addElementAtPoint } from "@canva/design";
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
import type {
  CreditBalance,
  EcommerceGenerationResponse,
  GenerationAsset,
  GenerationJobStatusResponse,
  LibraryResponse,
  MarketingGenerationResponse,
} from "./types";
import * as styles from "styles/imai.css";

const LIBRARY_PAGE_SIZE = 24;
const INITIAL_LIBRARY_PAGE_SIZE = 36;
const LIBRARY_SCROLL_THRESHOLD_PX = 240;
const POLLING_INTERVAL_MS = 2 * 60 * 1000;
const MAX_POLLING_ATTEMPTS = 5;
const PROMPT_MIN_ROWS = 5;

type AppStage = "booting" | "showcase" | "setup" | "verifying" | "ready";
type GenerationState = "idle" | "submitting" | "polling";
type ContentTab = "media" | "catalogue" | "library";

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
  onPromptChange: (value: string) => void;
  onRemoveSource: () => void;
  onFileChange: (file: File | null) => Promise<void>;
  actionLabel: string;
  actionBusy: boolean;
  onGenerate: () => Promise<void>;
  assets: GenerationAsset[];
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
    answer: "Check that your key is valid and your IMAI.Studio account is active.",
  },
] as const;

const SUPPORT_EMAIL = "tech@IMAI.Studio";

const buildAssetLabel = (asset: Partial<GenerationAsset>, index: number) =>
  asset.productName ||
  asset.versionName ||
  asset.prompt ||
  `Asset ${index + 1}`;

const isCompletedJobResponse = (
  value: GenerationJobResult | GenerationJobStatusResponse,
): value is GenerationJobStatusResponse =>
  "status" in value && value.status === "completed";

const getCompletedJobResult = (
  value: GenerationJobResult | GenerationJobStatusResponse,
): GenerationJobResult | null => {
  if (!isCompletedJobResponse(value)) {
    return null;
  }

  return value.result ?? null;
};

const createImageAsset = (
  url: string,
  index: number,
  labelPrefix: string,
): GenerationAsset => ({
  id: `${labelPrefix}-${index}-${url}`,
  type: "image",
  url,
  thumbnailUrl: url,
  label: `${labelPrefix} ${index + 1}`,
});

const mapMarketingResultToAssets = (
  result: MarketingGenerationResponse,
): GenerationAsset[] => {
  return (result.urls || []).map((url, index) =>
    createImageAsset(url, index, "Generated asset"),
  );
};

const mapEcommerceResultToAssets = (
  result: EcommerceGenerationResponse,
): GenerationAsset[] => {
  return (result.images?.urls || []).map((url, index) =>
    createImageAsset(url, index, "Catalogue asset"),
  );
};

const mapLibraryResponse = (response: LibraryResponse): GenerationAsset[] =>
  response.generations.map((generation, index) => ({
    ...generation,
    thumbnailUrl: generation.thumbnailUrl || generation.url,
    label: generation.label || buildAssetLabel(generation, index),
  }));

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
    description:
      "Skip the expensive equipment & lighting crews;<br />get hyper-realistic lifestyle shots<br />without leaving your tab",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/02.jpg",
  },
  {
    title: "Multiple Angles in One Go",
    description:
      "Generate a complete suite of professional<br />marketing assets for your brand<br />with a single click",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/03.jpg",
  },
  {
    title: "Zero Setup",
    description:
      "Forget long descriptions;<br />create stunning lifestyle scenes<br />for your products instantly",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/04.jpg",
  },
];

const CATALOGUE_SHOWCASE_CARDS: ShowcaseCard[] = [
  {
    title: "E-comm Photos",
    description:
      "Generate high-end product shots<br />optimized for Ecommerce Websites",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/05.webp",
  },
  {
    title: "Multiple Angles",
    description:
      "Get every angle you need for your product listing<br />in one seamless generation",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/06.webp",
  },
  {
    title: "Modern Aesthetics",
    description:
      "Automatically place your products against clean,<br />high-end studio backgrounds<br />for a premium look",
    thumbnailUrl: "https://assets.imai.studio/admin/canva/07.webp",
  },
  {
    title: "Instant Variety",
    description:
      "Quickly swap between close-ups and wide shots<br />to showcase every detail<br />of your product.",
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

const inferImageMimeType = (asset: GenerationAsset) => {
  if (asset.metadata?.mimeType?.startsWith("image/")) {
    return asset.metadata.mimeType as ImageMimeType;
  }

  return "image/jpeg";
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

const wait = (durationMs: number) =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

const openExternalUrl = async (url: string) => {
  await requestOpenExternalUrl({ url });
};

const openExternalUrlAsset = async (asset: GenerationAsset) => {
  await openExternalUrl(asset.url);
};

const revokeSourcePreviewUrl = (source: UploadedSource | null) => {
  if (source?.localPreviewUrl) {
    URL.revokeObjectURL(source.localPreviewUrl);
  }
};

const addAssetToDesign = async (asset: GenerationAsset) => {
  if (asset.type === "image") {
    const imageUploadOptions = {
      type: "image",
      name: asset.label,
      mimeType: inferImageMimeType(asset),
      url: asset.url,
      thumbnailUrl: asset.thumbnailUrl || asset.url,
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

    await addElementAtPoint({
      type: "image",
      ref: queuedImage.ref,
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
            <button
              type="button"
              className={styles.dangerTileButton}
              aria-label="Remove key"
              onClick={onRemove}
            >
              <TrashIcon />
            </button>
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
            <button
              type="button"
              className={styles.dangerTileButton}
              aria-label="Remove key"
              onClick={onRemove}
            >
              <TrashIcon />
            </button>
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

const ResultPreviewCard = ({
  assets,
  isGenerating,
}: {
  assets: GenerationAsset[];
  isGenerating: boolean;
}) => {
  const previewAssets = assets.slice(0, 4);
  const layoutClassName =
    previewAssets.length === 1
      ? styles.previewGridSingle
      : previewAssets.length === 2
        ? styles.previewGridSplit
        : styles.previewGridQuad;

  return (
    <div className={styles.previewShell}>
      {previewAssets.length ? (
        <div className={`${styles.previewGrid} ${layoutClassName}`}>
          {previewAssets.map((asset) => (
            <div key={asset.id} className={styles.previewTile}>
              <img
                src={asset.thumbnailUrl || asset.url}
                alt={asset.label}
                className={styles.previewImage}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.previewEmptyState}>
          <div className={styles.previewEmptyBox}>
            <div className={styles.previewEmptyContent}>
              <div className={styles.previewEmptyIcon} aria-hidden="true">
                <ImageIcon />
              </div>
              <Text alignment="center" tone="secondary">
                Images appear here
              </Text>
            </div>
          </div>
          {isGenerating ? (
            <div className={styles.previewLoadingState}>
              <div className={styles.previewSpinner} aria-hidden="true" />
              <Text alignment="center">Generating</Text>
            </div>
          ) : null}
        </div>
      )}
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
      <img alt="" className={styles.showcaseImage} src={thumbnailUrl} />
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
  onPromptChange,
  onRemoveSource,
  onFileChange,
  actionLabel,
  actionBusy,
  onGenerate,
  assets,
  credits,
  showcaseCards,
  details,
}: GenerationPanelProps) => (
  <div className={`${styles.sectionShell} ${styles.generationSectionShell}`}>
    <Rows spacing="2u">
      <ResultPreviewCard assets={assets} isGenerating={actionBusy} />
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

          <div className={styles.primaryActionButton}>
            <Button
              variant="primary"
              onClick={onGenerate}
              loading={actionBusy}
              stretch={true}
            >
              {actionLabel}
            </Button>
          </div>

          <div className={styles.primaryActionButton}>
            <FileInput
              accept={["image/png"]}
              disabled={uploadBusy}
              stretchButton
              onDropAcceptedFiles={(files) => {
                void onFileChange(files[0] ?? null);
              }}
            />
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
                <img
                  src={source.localPreviewUrl}
                  alt="Uploaded source"
                  className={styles.sourcePreviewImage}
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

          {assets.length ? (
            <Grid columns={2} spacing="2u">
              {assets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onAdd={addAssetToDesign}
                  onDownload={openExternalUrlAsset}
                />
              ))}
            </Grid>
          ) : null}
        </Rows>
      </div>
    </Rows>
  </div>
);

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
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [generationState, setGenerationState] =
    useState<GenerationState>("idle");
  const [generationMessage, setGenerationMessage] = useState("");
  const [sourceImportTab, setSourceImportTab] = useState<ContentTab | null>(
    null,
  );
  const [mediaUploadError, setMediaUploadError] = useState("");
  const [catalogueUploadError, setCatalogueUploadError] = useState("");
  const [mediaPrompt, setMediaPrompt] = useState("");
  const [mediaSource, setMediaSource] = useState<UploadedSource | null>(null);
  const [cataloguePrompt, setCataloguePrompt] = useState("");
  const [catalogueSource, setCatalogueSource] = useState<UploadedSource | null>(
    null,
  );
  const [mediaAssets, setMediaAssets] = useState<GenerationAsset[]>([]);
  const [catalogueAssets, setCatalogueAssets] = useState<GenerationAsset[]>([]);
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
    setMediaAssets([]);
    setCatalogueAssets([]);
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

  const handleBrokenLibraryAsset = (assetId: string) => {
    setLibraryAssets((currentAssets) =>
      currentAssets.filter((asset) => asset.id !== assetId),
    );
  };

  const pollUntilCompleted = async (
    jobId: string,
  ): Promise<GenerationJobStatusResponse> => {
    let latestStatus: GenerationJobStatusResponse | null = null;

    for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await wait(POLLING_INTERVAL_MS);
      }

      latestStatus = await getGenerationStatus(apiKey as string, jobId);

      if (latestStatus.status === "completed") {
        return latestStatus;
      }

      if (latestStatus.status === "failed") {
        throw new Error(
          latestStatus.error?.message || "Generation failed before completion.",
        );
      }
    }

    throw new Error(
      latestStatus?.error?.message ||
        "Generation is still processing after the polling window.",
    );
  };

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
    onCompleted: (result: GenerationJobResult) => void,
  ) => {
    if (!apiKey) {
      return;
    }

    setGenerationState("submitting");
    setGenerationMessage("Submitting request to IMAI.Studio...");
    setActiveJobId(null);

    try {
      const initialResponse = await runner();
      const initialCompletedResult = getCompletedJobResult(initialResponse);

      if (initialCompletedResult) {
        onCompleted(initialCompletedResult);
      } else if (initialResponse.accepted && initialResponse.jobId) {
        setActiveJobId(initialResponse.jobId);
        setGenerationState("polling");
        setGenerationMessage(
          "Generation queued. Checking status every 2 minutes for up to 5 attempts.",
        );

        const statusResponse = await pollUntilCompleted(initialResponse.jobId);
        const completedResult = getCompletedJobResult(statusResponse);

        if (!completedResult) {
          throw new Error("Generation completed without a result payload.");
        }

        onCompleted(completedResult);
      } else {
        onCompleted(initialResponse);
      }

      await syncCredits();
      setGenerationMessage("Generation completed.");
    } catch (error) {
      setGenerationMessage(
        error instanceof Error ? error.message : "Generation failed.",
      );
    } finally {
      setGenerationState("idle");
      setActiveJobId(null);
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
          prompt: mediaPrompt.trim() || undefined,
        }),
      (result) => {
        setMediaAssets(
          mapMarketingResultToAssets(result as MarketingGenerationResponse),
        );
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
      (result) => {
        const ecommerceResult = result as EcommerceGenerationResponse;
        setCatalogueAssets(mapEcommerceResultToAssets(ecommerceResult));
        setCatalogueDetails(extractEcommerceDetails(ecommerceResult));
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
                <Alert tone={generationState === "idle" ? "positive" : "info"}>
                  {generationMessage}
                  {activeJobId ? ` Job: ${activeJobId}` : ""}
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
                        onPromptChange={setMediaPrompt}
                        onRemoveSource={() => clearSource("media")}
                        onFileChange={(file) =>
                          handleSourceFileSelection("media", file)
                        }
                        actionLabel="Generate"
                        actionBusy={generationState !== "idle"}
                        onGenerate={handleMediaGeneration}
                        assets={mediaAssets}
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
                        actionLabel="Generate"
                        actionBusy={generationState !== "idle"}
                        onGenerate={handleCatalogueGeneration}
                        assets={catalogueAssets}
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
