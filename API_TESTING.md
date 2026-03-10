# API v1 Testing Guide

This document provides examples for testing all API v1 endpoints using both **curl** and **Postman**.

## Prerequisites

The API uses **API keys** as the authentication mechanism. For the storage upload endpoint (`POST /api/v1/storage`), you must also configure an allowed host list on the server to prevent SSRF.

### How It Works

1. **Generate an API key** in your organization's settings on the website
2. **Use the API key** in the `Authorization` header of your requests: `Bearer sk_live_xxxxx`
3. The API validates the key, checks scopes, and returns data for your organization

For API clients, API keys are still all you need in requests. Server-side environment configuration is required for some endpoints (see storage note below).

## Base URL

Replace `YOUR_DOMAIN` with your actual domain:

- **Local Development**: `http://localhost:3000`
- **Production**: `https://www.imai.studio`

## Authentication

Most endpoints require API key authentication. Include your API key in the `Authorization` header:

```
Authorization: Bearer sk_live_xxxxx
```

Replace `sk_live_xxxxx` with your actual API key.

---

## Endpoints

### 1. Health Check

Check if the API is running and accessible.

**Endpoint**: `GET /api/v1/health`

**Authentication**: None required

**Response**: Returns API status and version information

---

#### curl Example

```bash
curl -X GET "https://www.imai.studio/api/v1/health" \
  -H "Content-Type: application/json"
```

#### Postman Setup

1. **Method**: `GET`
2. **URL**: `https://www.imai.studio/api/v1/health`
3. **Headers**:
   - `Content-Type: application/json`
4. **Body**: None

#### Expected Response

```json
{
  "status": "ok",
  "timestamp": "2026-01-28T12:00:00.000Z",
  "version": "1.0.0"
}
```

---

### 2. Get Library Assets

Retrieve library assets (images, videos, 3D models) for your organization.

**⚠️ IMPORTANT**: The original `/api/v1/library` endpoint is deprecated due to Convex limitations. Please use the new split endpoints below.

---

#### 2a. Get Design Library Assets

Retrieve chat generation assets (design assets created without a specific product/version).

**Endpoint**: `GET /api/v1/library/design`

**Authentication**: Required (API key with `library:read` scope)

**Query Parameters**:

- `numItems` (optional): Number of results to return (max 100, default 50)
- `type` (optional): Filter by asset type (`image`, `video`, or `3d`)
- `cursor` (optional): Opaque cursor string for pagination. Use `nextCursor` from `pagination` in previous response to get next page.

**Response**: Returns design generations with pagination info

---

#### 2b. Get Marketing Library Assets

Retrieve marketing generation assets (assets created for specific products/versions).

**Endpoint**: `GET /api/v1/library/marketing`

**Authentication**: Required (API key with `library:read` scope)

**Query Parameters**:

- `numItems` (optional): Number of results to return (max 100, default 50)
- `type` (optional): Filter by asset type (`image`, `video`, or `3d`)
- `cursor` (optional): Opaque cursor string for pagination. Use `nextCursor` from `pagination` in previous response to get next page.

**Response**: Returns marketing generations with pagination info

---

#### 2c. Legacy Combined Endpoint (Deprecated)

⚠️ **DEPRECATED**: This endpoint makes multiple paginated queries and may fail with Convex errors. Use the split endpoints above instead.

**Endpoint**: `GET /api/v1/library`

---

#### curl Examples

**Get Design Library Assets (chat generations)**:

```bash
curl -X GET "https://www.imai.studio/api/v1/library/design" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json"
```

**Get Marketing Library Assets (product generations)**:

```bash
curl -X GET "https://www.imai.studio/api/v1/library/marketing" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json"
```

**With numItems (design assets)**:

```bash
curl -X GET "https://www.imai.studio/api/v1/library/design?numItems=25" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json"
```

**Filter by type (marketing images only)**:

```bash
curl -X GET "https://www.imai.studio/api/v1/library/marketing?type=image&numItems=10" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json"
```

**Filter by type (design videos only)**:

```bash
curl -X GET "https://www.imai.studio/api/v1/library/design?type=video&numItems=10" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json"
```

**Filter by type (marketing 3D models only)**:

```bash
curl -X GET "https://www.imai.studio/api/v1/library/marketing?type=3d&numItems=10" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json"
```

**Pagination (first page of design assets)**:

```bash
curl -X GET "https://www.imai.studio/api/v1/library/design?numItems=25" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json"
```

**Pagination (next page using cursor)**:

```bash
curl -X GET "https://www.imai.studio/api/v1/library/design?numItems=25&cursor=MTcwNjQ1NzYwMDAwMDpjaGF0" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json"
```

**Legacy Combined Endpoint (Not Recommended)**:

```bash
curl -X GET "https://www.imai.studio/api/v1/library" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json"
```

#### Postman Setup

**For Design Library Assets:**

1. **Method**: `GET`
2. **URL**: `https://www.imai.studio/api/v1/library/design`
3. **Headers**:
   - `Authorization: Bearer sk_live_xxxxx`
   - `Content-Type: application/json`
4. **Params** (optional):
   - `numItems`: `25` (number, max 100)
   - `type`: `image` | `video` | `3d`
   - `cursor`: `MTcwNjQ1NzYwMDAwMDpjaGF0` (string, opaque cursor for pagination)
5. **Body**: None

**For Marketing Library Assets:**

1. **Method**: `GET`
2. **URL**: `https://www.imai.studio/api/v1/library/marketing`
3. **Headers**:
   - `Authorization: Bearer sk_live_xxxxx`
   - `Content-Type: application/json`
4. **Params** (optional):
   - `numItems`: `25` (number, max 100)
   - `type`: `image` | `video` | `3d`
   - `cursor`: `MTcwNjQ1NzYwMDAwMDptYXJrZXRpbmc` (string, opaque cursor for pagination)
5. **Body**: None

#### Expected Response

**Design Library Assets Response** (`/api/v1/library/design`):

```json
{
  "generations": [
    {
      "id": "abc123",
      "type": "image",
      "url": "https://...",
      "thumbnailUrl": "https://...",
      "status": "completed",
      "createdAt": 1706457600000,
      "metadata": {
        "width": 1024,
        "height": 1024,
        "mimeType": "image/png"
      }
    }
  ],
  "pagination": {
    "hasMore": true,
    "nextCursor": "MTcwNjQ1NzYwMDAwMDpjaGF0"
  }
}
```

**Marketing Library Assets Response** (`/api/v1/library/marketing`):

```json
{
  "generations": [
    {
      "id": "def456",
      "type": "image",
      "url": "https://...",
      "thumbnailUrl": "https://...",
      "prompt": "A beautiful landscape",
      "status": "completed",
      "createdAt": 1706457600000,
      "productName": "Product Name",
      "versionName": "Version Name",
      "metadata": {
        "width": 1024,
        "height": 1024,
        "mimeType": "image/png"
      }
    }
  ],
  "pagination": {
    "hasMore": true,
    "nextCursor": "MTcwNjQ1NzYwMDAwMDptYXJrZXRpbmc"
  }
}
```

#### Error Responses

**401 Unauthorized** (Invalid or missing API key):

```json
{
  "error": "Invalid or expired API key",
  "message": "Please check your API key or generate a new one"
}
```

**403 Forbidden** (Missing required scope):

```json
{
  "error": "Insufficient permissions",
  "message": "API key does not have library:read scope"
}
```

---

### 3. Get Credits Balance

Retrieve credit balance information for your organization.

**Endpoint**: `GET /api/v1/credits`

**Authentication**: Required (API key with `credits:read` scope)

**Response**: Returns credit balance, usage, and grant information

---

#### curl Example

```bash
curl -X GET "https://www.imai.studio/api/v1/credits" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json"
```

#### Postman Setup

1. **Method**: `GET`
2. **URL**: `https://www.imai.studio/api/v1/credits`
3. **Headers**:
   - `Authorization: Bearer sk_live_xxxxx`
   - `Content-Type: application/json`
4. **Body**: None

#### Expected Response

```json
{
  "balance": 1500,
  "totalCredits": 2000,
  "usedCredits": 500,
  "grantsCount": 3,
  "nextExpiry": {
    "amount": 200,
    "expiresAt": 1709251200000,
    "daysUntilExpiry": 7
  }
}
```

**Response when no grants are expiring soon**:

```json
{
  "balance": 1500,
  "totalCredits": 2000,
  "usedCredits": 500,
  "grantsCount": 3,
  "nextExpiry": null
}
```

#### Error Responses

**401 Unauthorized** (Invalid or missing API key):

```json
{
  "error": "Invalid or expired API key",
  "message": "Please check your API key or generate a new one"
}
```

**403 Forbidden** (Missing required scope):

```json
{
  "error": "Insufficient permissions",
  "message": "API key does not have credits:read scope"
}
```

---

### 4. Generate Design

Generate product design assets using the Product Agent (image generation, asset creation, library). Supports two modes:

- **With `versionId`**: Runs the Product Agent for that product version. Generated images attach to that version and appear in the library as **marketing generations**. Response includes `assetIds`.
- **Without `versionId`**: Runs the org agent on a dedicated API thread. Generated images go to the library as **chat generations**. Response includes `linkIds`.

**Endpoint**: `POST /api/v1/generate/design`

**Authentication**: Required (API key with `generate:write` scope)

**Request Body**:

- `prompt` (required): The prompt describing what you want to generate (e.g. design concepts, new assets).
- `url` (required): URL of the product image to analyze or use as reference.
- `versionId` (optional): Convex version ID. When provided, assets are created under this product version; when omitted, assets are created in the org's API thread.
- `async` (boolean, optional): When `true`, returns immediately with a `jobId` instead of waiting for generation.
- `webhookUrl` (string, optional): HTTPS endpoint to notify when the async job finishes.
- `webhookSecret` (string, optional): Optional secret used to sign webhook payloads (`X-IMAI-Signature: sha256=...`).

**Response**: AI-generated text and, when the agent created assets, `assetIds` (product assets) and/or `linkIds` (thread assets).

---

#### curl Examples

**Design with version (assets attach to product version)**:

```bash
curl -X POST "https://www.imai.studio/api/v1/generate/design" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Generate 2 lifestyle shots and 1 detail close-up for this product",
    "url": "https://example.com/product-image.jpg",
    "versionId": "jd7abc123xyz"
  }'
```

**Design without version (assets go to library as chat generations)**:

```bash
curl -X POST "https://www.imai.studio/api/v1/generate/design" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Describe this product and suggest 3 creative photoshoot concepts",
    "url": "https://example.com/product-image.jpg"
  }'
```

#### Postman Setup

1. **Method**: `POST`
2. **URL**: `https://www.imai.studio/api/v1/generate/design`
3. **Headers**:
   - `Authorization: Bearer sk_live_xxxxx`
   - `Content-Type: application/json`
4. **Body** (raw JSON):

```json
{
  "prompt": "Generate 2 lifestyle shots for this product",
  "url": "https://example.com/product-image.jpg",
  "versionId": "jd7abc123xyz"
}
```

Omit `versionId` to use thread-based generation.

For async mode, add:

```json
{
  "prompt": "Generate 2 lifestyle shots for this product",
  "url": "https://example.com/product-image.jpg",
  "async": true,
  "webhookUrl": "https://your-webhook-endpoint.example.com/generation"
}
```

#### Expected Response

**With assets created (e.g. versionId provided)**:

```json
{
  "success": true,
  "text": "I've started generating 2 lifestyle assets...",
  "assetIds": ["k57asset1abc", "k57asset2def"]
}
```

**Thread-based (no versionId)**:

```json
{
  "success": true,
  "text": "Generated 4 design variations...",
  "linkIds": ["link_abc123", "link_def456"]
}
```

**Text only (no assets created)**:

```json
{
  "success": true,
  "text": "This is a premium leather wallet with..."
}
```

**Async accepted (recommended for long generations)**:

```json
{
  "success": true,
  "accepted": true,
  "jobId": "jh7k2...abc",
  "status": "queued",
  "statusEndpoint": "/api/v1/generate/status?jobId=jh7k2...abc"
}
```

#### Error Responses

**400 Bad Request** (Missing required fields):

```json
{
  "error": "Invalid request body",
  "message": "prompt is required and must be a string"
}
```

**401 Unauthorized** (Invalid or missing API key):

```json
{
  "error": "Invalid or expired API key",
  "message": "Please check your API key or generate a new one"
}
```

**403 Forbidden** (Missing required scope):

```json
{
  "error": "Insufficient permissions",
  "message": "API key does not have generate:write scope"
}
```

---

### 5. Generate Marketing

Generate **marketing images** and/or **catalogue data** using the same Marketing Agent that powers the product page. This endpoint bypasses the suggestion selection step – assets are generated immediately and URLs + asset IDs are returned.

Designed for **external callers**: no internal version IDs required. Just provide a product image URL and the system auto-creates a product + version behind the scenes.

**Endpoint**: `POST /api/v1/generate/marketing`

**Authentication**: Required (API key with `generate:write` scope)

**Request Body**:

- `url` (string, required*): URL of the product image. *Required when `versionId` is not provided. This is the only field you need to get started.
- `prompt` (string, optional): Custom generation instructions. If omitted, a comprehensive default marketing prompt is used that generates listing shots, lifestyle images, and social ads.
- `action` (string, optional, default `"generate"`): Controls what to generate:
  - `"generate"` – Generate marketing / listing images only.
  - `"catalogue"` – Generate catalogue data (e-commerce details) only.
  - `"all"` – Generate both images AND catalogue data.
- `versionId` (string, optional): Convex version ID to attach to an existing product version. If omitted, a shadow product + version is auto-created for your workspace. The auto-created `versionId` is returned in the response for follow-up calls.
- `catalogueStatement` (string, optional): Custom instructions for catalogue data generation.
- `includeCatalogueData` (boolean, optional): Shorthand to also generate catalogue data.
- `async` (boolean, optional): When `true`, returns immediately with a `jobId` instead of waiting for generation.
- `webhookUrl` (string, optional): HTTPS endpoint to notify when the async job finishes.
- `webhookSecret` (string, optional): Optional secret used to sign webhook payloads (`X-IMAI-Signature: sha256=...`).

**Response**:

- `success` (boolean): Whether the request succeeded.
- `versionId` (string): The version ID used (auto-created or provided). Save this for follow-up calls.
- `urls` (string[]): Public URLs of generated images (empty array if none).
- `assetIds` (string[]): Asset IDs of generated images (empty array if none).
- `catalogueUpdated` (boolean, optional): `true` if catalogue data was updated.
- `failedIds` (string[], optional): Asset IDs that failed generation.
- `pendingIds` (string[], optional): Asset IDs still processing after timeout.
- `text` (string, optional): Agent summary text (useful for debugging).

---

#### curl Examples

**Simplest: just provide a product image URL (everything auto-created)**:

```bash
curl -X POST "https://www.imai.studio/api/v1/generate/marketing" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product-image.jpg"
  }'
```

**With custom prompt**:

```bash
curl -X POST "https://www.imai.studio/api/v1/generate/marketing" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product-image.jpg",
    "prompt": "Generate 6 e-commerce listing shots and 2 lifestyle images"
  }'
```

**Generate catalogue data only**:

```bash
curl -X POST "https://www.imai.studio/api/v1/generate/marketing" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product-image.jpg",
    "action": "catalogue"
  }'
```

**Generate both images + catalogue data**:

```bash
curl -X POST "https://www.imai.studio/api/v1/generate/marketing" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product-image.jpg",
    "action": "all"
  }'
```

**With existing versionId (for follow-up generations on same product)**:

```bash
curl -X POST "https://www.imai.studio/api/v1/generate/marketing" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "versionId": "jd7abc123xyz",
    "prompt": "Generate 3 more lifestyle images"
  }'
```

**With custom catalogue instructions**:

```bash
curl -X POST "https://www.imai.studio/api/v1/generate/marketing" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product-image.jpg",
    "action": "all",
    "catalogueStatement": "Emphasize sustainable materials and care instructions"
  }'
```

#### Postman Setup

1. **Method**: `POST`
2. **URL**: `https://www.imai.studio/api/v1/generate/marketing`
3. **Headers**:
   - `Authorization: Bearer sk_live_xxxxx`
   - `Content-Type: application/json`
4. **Body** (raw JSON):

```json
{
  "url": "https://example.com/product-image.jpg",
  "action": "all",
  "prompt": "Generate 6 e-commerce listing shots and 2 lifestyle images",
  "async": true,
  "webhookUrl": "https://your-webhook-endpoint.example.com/generation"
}
```

#### Expected Response

**With images generated (note: versionId is returned for follow-up calls)**:

```json
{
  "success": true,
  "versionId": "jd7abc123xyz",
  "urls": [
    "https://cdn.example.com/orgslug/image/uuid1.png",
    "https://cdn.example.com/orgslug/image/uuid2.png"
  ],
  "assetIds": ["k57asset1abc", "k57asset2def"]
}
```

**With images and catalogue updated**:

```json
{
  "success": true,
  "versionId": "jd7abc123xyz",
  "urls": [
    "https://cdn.example.com/orgslug/image/uuid1.png",
    "https://cdn.example.com/orgslug/image/uuid2.png"
  ],
  "assetIds": ["k57asset1abc", "k57asset2def"],
  "catalogueUpdated": true
}
```

**Catalogue only**:

```json
{
  "success": true,
  "versionId": "jd7abc123xyz",
  "urls": [],
  "assetIds": [],
  "catalogueUpdated": true,
  "text": "Catalogue data updated with product description, materials, key features, and highlights."
}
```

**Async accepted (recommended for long generations)**:

```json
{
  "success": true,
  "accepted": true,
  "jobId": "jh7k2...abc",
  "status": "queued",
  "statusEndpoint": "/api/v1/generate/status?jobId=jh7k2...abc"
}
```

#### Error Responses

**400 Bad Request** (Missing required fields):

```json
{
  "error": "Invalid request body",
  "message": "url (product image URL) is required. Optionally provide versionId to attach to an existing product version."
}
```

**401 Unauthorized** (Invalid or missing API key):

```json
{
  "error": "Invalid or expired API key",
  "message": "Please check your API key or generate a new one"
}
```

**403 Forbidden** (Missing required scope):

```json
{
  "error": "Insufficient permissions",
  "message": "API key does not have generate:write scope"
}
```

### 6. Generation Job Status (Async)

Check async generation jobs created via `POST /api/v1/generate/design` or `POST /api/v1/generate/marketing`.

**Endpoint**: `GET /api/v1/generate/status?jobId=<jobId>`

**Authentication**: Required (same API key used to create the job)

#### curl Example

```bash
curl -X GET "https://www.imai.studio/api/v1/generate/status?jobId=jh7k2...abc" \
  -H "Authorization: Bearer sk_live_xxxxx"
```

#### Postman Setup

1. **Method**: `GET`
2. **URL**: `https://YOUR_DOMAIN/api/v1/generate/status?jobId=jh7k2...abc`
3. **Headers**:
   - `Authorization: Bearer sk_live_xxxxx`

#### Expected Response

```json
{
  "success": true,
  "jobId": "jh7k2...abc",
  "endpoint": "marketing",
  "status": "completed",
  "result": {
    "versionId": "jd7abc123xyz",
    "urls": ["https://cdn.example.com/orgslug/image/uuid1.png"],
    "assetIds": ["k57asset1abc"],
    "failedIds": [],
    "pendingIds": [],
    "linkIds": []
  },
  "webhook": {
    "attempts": 1,
    "deliveredAt": 1739633000000,
    "lastStatusCode": 200
  }
}
```

#### Webhook Payload

When `webhookUrl` is provided in async mode, your endpoint receives:

```json
{
  "event": "generation.job.finished",
  "jobId": "jh7k2...abc",
  "endpoint": "marketing",
  "status": "completed",
  "completedAt": 1739633000000,
  "result": {
    "versionId": "jd7abc123xyz",
    "urls": ["https://cdn.example.com/orgslug/image/uuid1.png"],
    "assetIds": ["k57asset1abc"],
    "failedIds": [],
    "pendingIds": [],
    "linkIds": []
  },
  "error": null
}
```

Webhook headers:

- `X-IMAI-Event: generation.job.finished`
- `X-IMAI-Job-Id: <jobId>`
- `X-IMAI-Attempt: <attempt-number>`
- `X-IMAI-Signature: sha256=<hmac>` (only when `webhookSecret` is supplied)

For quick webhook testing:

- `https://webhook.site/` (instant inspect + request history)
- `https://pipedream.com/requestbin` (request bin + optional workflows)

---

### 8. Generate E-commerce Content

Generate comprehensive e-commerce content including images, product details, titles, and platform-specific formatting for Shopify, WordPress, Amazon, and other platforms.

**Endpoint**: `POST /api/v1/generate/ecommerce`

**Authentication**: Required (API key with `generate:write` scope)

**Request Body**:

- `url` (string, optional): Product image URL to use as reference.
- `prompt` (string, optional): Custom generation instructions.
- `platforms` (string[], optional): Target platforms: `["shopify", "wordpress", "amazon", "generic", "etsy", "ebay"]` (default: `["generic"]`).
- `includeImages` (boolean, optional): Generate product images (default: `true`).
- `includeDetails` (boolean, optional): Generate product details/descriptions (default: `true`).
- `includeTitles` (boolean, optional): Generate SEO-optimized titles (default: `true`).
- `includeSpecs` (boolean, optional): Generate technical specifications (default: `true`).
- `async` (boolean, optional): Enable async processing.
- `webhookUrl` (string, optional): HTTPS endpoint to notify when the async job finishes.
- `webhookSecret` (string, optional): Optional secret used to sign webhook payloads (`X-IMAI-Signature: sha256=...`).

**Response**: Comprehensive e-commerce content with images, product details, and platform-specific formatting.

---

#### curl Examples

**Basic e-commerce generation (all defaults)**:

```bash
curl -X POST "https://www.imai.studio/api/v1/generate/ecommerce" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product-image.jpg"
  }'
```

**Custom platforms and options**:

```bash
curl -X POST "https://www.imai.studio/api/v1/generate/ecommerce" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product-image.jpg",
    "prompt": "Generate premium leather goods content",
    "platforms": ["shopify", "amazon"],
    "includeImages": true,
    "includeDetails": true,
    "includeTitles": true,
    "includeSpecs": true
  }'
```

**Images only**:

```bash
curl -X POST "https://www.imai.studio/api/v1/generate/ecommerce" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product-image.jpg",
    "includeImages": true,
    "includeDetails": false,
    "includeTitles": false,
    "includeSpecs": false
  }'
```

**Async with webhook**:

```bash
curl -X POST "https://www.imai.studio/api/v1/generate/ecommerce" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product-image.jpg",
    "async": true,
    "webhookUrl": "https://your-webhook-endpoint.example.com/ecommerce"
  }'
```

#### Postman Setup

1. **Method**: `POST`
2. **URL**: `https://YOUR_DOMAIN/api/v1/generate/ecommerce`
3. **Headers**:
   - `Authorization: Bearer sk_live_xxxxx`
   - `Content-Type: application/json`
4. **Body** (raw JSON):

```json
{
  "url": "https://example.com/product-image.jpg",
  "platforms": ["shopify", "amazon"],
  "prompt": "Generate premium product content",
  "async": true,
  "webhookUrl": "https://your-webhook-endpoint.example.com/ecommerce"
}
```

#### Expected Response

**Successful generation**:

```json
{
  "success": true,
  "versionId": "jd7abc123xyz",
  "images": {
    "urls": [
      "https://cdn.example.com/orgslug/image/uuid1.png",
      "https://cdn.example.com/orgslug/image/uuid2.png"
    ],
    "assetIds": ["k57asset1abc", "k57asset2def"],
    "failedIds": [],
    "pendingIds": []
  },
  "details": {
    "title": "Premium Leather Wallet - Handcrafted Italian Design",
    "description": "Experience luxury with our handcrafted Italian leather wallet...",
    "features": [
      "Genuine Italian leather",
      "RFID blocking technology",
      "8 card slots"
    ],
    "specifications": {
      "dimensions": "4.5 x 3.5 x 0.5 inches",
      "weight": "120g",
      "material": "Full-grain Italian leather"
    },
    "platforms": {
      "shopify": {
        "title": "Premium Leather Wallet - Italian Design",
        "description": "Shop our handcrafted Italian leather wallet...",
        "tags": ["leather", "wallet", "luxury"],
        "handle": "premium-leather-wallet-italian-design"
      },
      "amazon": {
        "title": "Premium Italian Leather Wallet with RFID Protection",
        "bulletPoints": [
          "Genuine Italian full-grain leather",
          "RFID blocking technology for security",
          "8 credit card slots plus ID window"
        ],
        "description": "Experience luxury craftsmanship..."
      },
      "generic": {
        "title": "Premium Leather Wallet",
        "description": "Handcrafted Italian leather wallet...",
        "metadata": {
          "seoTitle": "Buy Premium Leather Wallet Online",
          "seoDescription": "Shop our handcrafted Italian leather wallet..."
        }
      }
    }
  }
}
```

**Async accepted**:

```json
{
  "success": true,
  "accepted": true,
  "jobId": "jh7k2...abc",
  "status": "queued",
  "statusEndpoint": "/api/v1/generate/status?jobId=jh7k2...abc"
}
```

**With pending assets**:

```json
{
  "success": true,
  "versionId": "jd7abc123xyz",
  "images": {
    "urls": [],
    "assetIds": ["k57asset1abc"],
    "failedIds": [],
    "pendingIds": ["k57asset2def"]
  },
  "details": {
    "title": "Premium Leather Wallet",
    "description": "Handcrafted Italian leather...",
    "features": ["Genuine leather", "RFID protection"],
    "specifications": {
      "dimensions": "4.5 x 3.5 x 0.5 inches"
    },
    "platforms": {
      "generic": {
        "title": "Premium Leather Wallet",
        "description": "Handcrafted Italian leather...",
        "metadata": {}
      }
    }
  }
}
```

#### Error Responses

**400 Bad Request** (Invalid platforms):

```json
{
  "error": "Invalid platforms",
  "message": "Invalid platforms: ['invalid']. Valid platforms: shopify, wordpress, amazon, generic, etsy, ebay"
}
```

**401 Unauthorized** (Invalid or missing API key):

```json
{
  "error": "Invalid or expired API key",
  "message": "Please check your API key or generate a new one"
}
```

**403 Forbidden** (Missing required scope):

```json
{
  "error": "Insufficient permissions",
  "message": "API key does not have generate:write scope"
}
```

**402 Payment Required** (Insufficient credits):

````json
{
  "error": "Insufficient credits",
  "message": "Insufficient credits. Please purchase more credits to use the API."
---

### 9. Upload URL to R2 Storage

Upload a file to R2 storage by providing a URL. The content at the URL will be fetched and stored in R2.

**Endpoint**: `POST /api/v1/storage`

**curl Example**

```bash
curl -X POST "https://www.imai.studio/api/v1/storage" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/image.jpg"
  }'
````

#### Postman Setup

1. **Method**: `POST`
2. **URL**: `https://www.imai.studio/api/v1/storage`
3. **Headers**:
   - `Authorization: Bearer sk_live_xxxxx`
   - `Content-Type: application/json`
4. **Body** (raw JSON):

```json
{
  "url": "https://example.com/image.jpg"
}
```

#### Expected Response

```json
{
  "storageKey": "orgSlug/file/uuid.jpg",
  "publicUrl": "https://r2.your-domain.com/orgSlug/file/uuid.jpg"
}
```

#### Error Responses

**400 Bad Request** (Missing required fields):

```json
{
  "error": "Missing required field: url"
}
```

**401 Unauthorized** (Invalid or missing API key):

```json
{
  "error": "Invalid or expired API key",
  "message": "Please check your API key or generate a new one"
}
```

**403 Forbidden** (Missing required scope):

```json
{
  "error": "Insufficient permissions",
  "message": "API key does not have storage:write scope"
}
```

- [ ] Request without `url` returns 400
- [ ] Request with valid API key and `url` returns 200
- [ ] Response includes `storageKey` and `publicUrl`

---

## 10. Store OAuth Token

Store an OAuth access token for a supported external platform.

**Endpoint**: `POST /api/v1/oauth`

**Authentication**: Required (any valid API key)

**Security Notes**:

- The API key is the only authentication mechanism for this endpoint.
- The server binds the stored token to the organization from the validated API key.
- Access tokens are stored as a one-way hash for verification. **For Shopify only**, the raw token is also stored so the backend can call the Shopify Admin API (e.g. list/update products) on your behalf.
- `refreshToken` is intentionally not accepted by this endpoint.

**Request Body**:

- `platform` (string, required): Platform name (e.g. `github`, `slack`, `discord`, `shopify`, or any other provider)
- `platformUserId` (string, required): User's ID on the external platform (for Shopify, use the store's myshopify.com domain)
- `token` (string, required): Raw OAuth access token (for Shopify, the Admin API access token, e.g. `shpua_...`)
- `tokenExpiresAt` (number, optional): Token expiration timestamp (recommended when the platform provides it)
- `scope` (string[], optional): OAuth scopes granted
- `metadata` (object, optional): Additional user metadata
  - `email` (string, optional): User's email
  - `username` (string, optional): User's username
  - `avatar` (string, optional): User's avatar URL
- `domain` (string, optional): Source domain (for Shopify, use the store's myshopify.com domain, e.g. `your-store.myshopify.com`)

**Response**: Success confirmation with stored token ID (`tokenId`). For Shopify, once stored, the token can be used from the Extensions → Shopify → My Store flow to list and edit products.

---

#### curl Examples

**Store GitHub OAuth token**:

```bash
curl -X POST "https://www.imai.studio/api/v1/oauth" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "github",
    "platformUserId": "12345",
    "token": "gho_xxxxxxxxxxxxxxxxxxxx",
    "tokenExpiresAt": 1735689600000,
    "scope": ["repo", "user:email"],
    "metadata": {
      "username": "johndoe",
      "email": "john@example.com",
      "avatar": "https://github.com/images/error/johndoe_happy.gif"
    },
    "domain": "github.com"
  }'
```

**Store Slack OAuth token**:

```bash
curl -X POST "https://www.imai.studio/api/v1/oauth" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "slack",
    "platformUserId": "U1234567890",
    "token": "xoxp-1234567890-1234567890-abcdefghijklmnopqrstuvwx",
    "scope": ["channels:read", "chat:write", "users:read"],
    "metadata": {
      "username": "johndoe",
      "email": "john@company.com"
    },
    "domain": "slack.com"
  }'
```

**Store Shopify OAuth token** (enables My Store → list/edit products in Extensions):

Use your store’s Admin API access token and myshopify.com domain. The raw token is stored so the app can call the Shopify Admin API on behalf of your organization.

```bash
curl -X POST "https://www.imai.studio/api/v1/oauth" \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "shopify",
    "platformUserId": "your-store.myshopify.com",
    "token": "shpua_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "scope": ["write_products", "write_files", "write_metaobjects"],
    "domain": "your-store.myshopify.com",
    "metadata": {
      "email": "admin@your-store.com"
    }
  }'
```

Example response:

```json
{
  "success": true,
  "tokenId": "xs75yb51zxpze93q5kjyd8me8h82chvt",
  "message": "OAuth token stored successfully"
}
```

After storing, the store appears under **Extensions → Shopify → My Store**. You can open it to list products and edit title, description, and images.

#### Postman Setup

1. **Method**: `POST`
2. **URL**: `https://YOUR_DOMAIN/api/v1/oauth`
3. **Headers**:
   - `Authorization: Bearer sk_live_xxxxx`
   - `Content-Type: application/json`
4. **Body** (raw JSON):

```json
{
  "platform": "github",
  "platformUserId": "12345",
  "token": "gho_xxxxxxxxxxxxxxxxxxxx",
  "tokenExpiresAt": 1735689600000,
  "scope": ["repo", "user:email"],
  "metadata": {
    "username": "johndoe",
    "email": "john@example.com",
    "avatar": "https://github.com/images/error/johndoe_happy.gif"
  },
  "domain": "github.com"
}
```

#### Expected Response

**Successful Token Storage** (`POST /api/v1/oauth`):

```json
{
  "success": true,
  "tokenId": "kd8token123abc",
  "message": "OAuth token stored successfully"
}
```

#### Error Responses

**400 Bad Request** (Missing required fields):

```json
{
  "error": "Missing required fields",
  "required": ["platform", "platformUserId", "token"]
}
```

**400 Bad Request** (`refreshToken` is no longer accepted):

```json
{
  "error": "refreshToken is not supported",
  "message": "Store only the access token. Refresh tokens are no longer accepted by this endpoint."
}
```

**401 Unauthorized** (Invalid or missing API key):

```json
{
  "error": "Invalid or expired API key",
  "message": "Please check your API key or generate a new one"
}
```

**500 Internal Server Error** (Server/storage error):

```json
{
  "error": "Internal server error",
  "message": "Failed to store OAuth token"
}
```

---

## Common Issues

### CORS Errors

All endpoints support CORS. If you encounter CORS issues:

- Ensure you're using the correct base URL
- Check that the `Origin` header matches your domain
- Verify CORS headers are present in the response

### Authentication Errors

If you get 401 errors:

- Verify your API key is correct
- Check that the API key hasn't expired
- Ensure the API key hasn't been revoked
- Verify the `Authorization` header format: `Bearer sk_live_xxxxx`

### Permission Errors

If you get 403 errors:

- Verify your API key has the required scope:
  - `library:read` for the library endpoint
  - `credits:read` for the credits endpoint
  - `generate:write` for the generate endpoints (design and marketing)
  - `storage:write` for the storage endpoint
- Generate a new API key with the correct scopes if needed

---

## Rate Limiting

API endpoints may implement rate limiting. If you encounter rate limit errors:

- Wait before retrying
- Implement exponential backoff in your client
- Contact support if you need higher rate limits

---

## Support

For issues or questions:

- Check the API response error messages
- Review your API key permissions
- Verify your request format matches the examples above
