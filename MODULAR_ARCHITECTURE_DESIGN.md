# Modular OOP Architecture Design

## 1. Architecture Principles

### 1.1 SOLID Principles
- **Single Responsibility:** Each class has one reason to change
- **Open/Closed:** Open for extension, closed for modification
- **Liskov Substitution:** Derived classes must be substitutable for base classes
- **Interface Segregation:** Many client-specific interfaces over one general interface
- **Dependency Inversion:** Depend on abstractions, not concretions

### 1.2 Additional Principles
- **DRY (Don't Repeat Yourself):** Eliminate code duplication
- **YAGNI (You Aren't Gonna Need It):** Don't add functionality until needed
- **Separation of Concerns:** Different concerns in different modules
- **Dependency Injection:** Services receive dependencies via constructor
- **Composition over Inheritance:** Prefer object composition to class inheritance

---

## 2. Layered Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│  (Bot Commands, Event Handlers, Discord Handlers)            │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
│  (Use Cases, Application Services, Orchestration)            │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                       Domain Layer                           │
│  (Business Logic, Entities, Value Objects, Domain Services)  │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                   Infrastructure Layer                       │
│  (External APIs, File System, Database, Third-party SDKs)    │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Module Design

### 3.1 Core Module

#### 3.1.1 Application Class
**Purpose:** Main application orchestrator, bootstraps all services

```typescript
// src/core/Application.ts

export class Application {
    private readonly config: Config;
    private readonly logger: ILogger;
    private readonly twitchService: ITwitchService;
    private readonly discordService: IDiscordService;
    private readonly commandRegistry: CommandRegistry;
    private readonly eventBus: EventBus;

    constructor(
        config: Config,
        logger: ILogger,
        twitchService: ITwitchService,
        discordService: IDiscordService,
        commandRegistry: CommandRegistry,
        eventBus: EventBus
    ) {
        this.config = config;
        this.logger = logger;
        this.twitchService = twitchService;
        this.discordService = discordService;
        this.commandRegistry = commandRegistry;
        this.eventBus = eventBus;
    }

    async start(): Promise<void> {
        this.logger.info('Starting application...');

        // Initialize services
        await this.discordService.connect();
        await this.twitchService.connect();

        // Register event handlers
        this.registerEventHandlers();

        this.logger.info('Application started successfully');
    }

    async stop(): Promise<void> {
        this.logger.info('Stopping application...');

        await this.twitchService.disconnect();
        await this.discordService.disconnect();

        this.logger.info('Application stopped');
    }

    private registerEventHandlers(): void {
        // Register all event handlers with the event bus
    }
}
```

#### 3.1.2 Config Class
**Purpose:** Centralized configuration management

```typescript
// src/core/Config.ts

export class Config {
    public readonly twitch: TwitchConfig;
    public readonly discord: DiscordConfig;
    public readonly openai: OpenAIConfig;
    public readonly cloudflare: CloudflareConfig;
    public readonly storage: StorageConfig;
    public readonly throttle: ThrottleConfig;

    constructor(env: Record<string, string | undefined>) {
        this.twitch = this.parseTwitchConfig(env);
        this.discord = this.parseDiscordConfig(env);
        this.openai = this.parseOpenAIConfig(env);
        this.cloudflare = this.parseCloudflareConfig(env);
        this.storage = this.parseStorageConfig(env);
        this.throttle = this.parseThrottleConfig(env);
    }

    // Parsing methods...
}

interface TwitchConfig {
    clientId: string;
    clientSecret: string;
    channels: Set<string>;
    admins: Set<string>;
    accessToken: string;
    refreshToken: string;
}

interface DiscordConfig {
    botToken: string;
    channels: string[];
    adminUserId: string;
}

interface OpenAIConfig {
    apiKey: string;
    model: string;
    imagesPerMinute: number;
    gateway?: string;
}

interface CloudflareConfig {
    accountId: string;
    apiToken: string;
    imagesUrl: string;
}

interface StorageConfig {
    dataDir: string;
    databaseUrl?: string;
}

interface ThrottleConfig {
    messageLimit: number;
    messageInterval: number;
    openaiLimit: number;
    openaiInterval: number;
    dalleLimit: number;
    dalleInterval: number;
}
```

---

### 3.2 Domain Layer

#### 3.2.1 Domain Models

```typescript
// src/domain/models/User.ts

export class User {
    constructor(
        public readonly username: string,
        public readonly displayName: string
    ) {}

    static create(username: string, displayName: string): User {
        if (!username || username.trim().length === 0) {
            throw new Error('Username cannot be empty');
        }
        return new User(username.toLowerCase(), displayName);
    }

    equals(other: User): boolean {
        return this.username === other.username;
    }
}
```

```typescript
// src/domain/models/Image.ts

export class Image {
    constructor(
        public readonly id: string,
        public readonly url: string,
        public readonly analysis: string,
        public readonly revisedPrompt: string,
        public readonly metadata: ImageMetadata,
        public readonly createdAt: Date
    ) {}

    static create(
        url: string,
        analysis: string,
        revisedPrompt: string,
        metadata: ImageMetadata
    ): Image {
        return new Image(
            nanoid(14),
            url,
            analysis,
            revisedPrompt,
            metadata,
            new Date()
        );
    }
}

export interface ImageMetadata {
    source: 'twitch' | 'discord';
    channel: string;
    target: string;
    trigger: 'subscribing' | 'gifting' | 'custom' | 'test';
    theme?: string;
    style?: string;
}
```

```typescript
// src/domain/models/Theme.ts

export class Theme {
    constructor(
        public readonly broadcaster: string,
        public readonly description: string
    ) {}

    static create(broadcaster: string, description: string): Theme {
        if (!broadcaster || broadcaster.trim().length === 0) {
            throw new Error('Broadcaster cannot be empty');
        }
        if (!description || description.trim().length === 0) {
            throw new Error('Theme description cannot be empty');
        }
        return new Theme(broadcaster.toLowerCase(), description);
    }
}
```

```typescript
// src/domain/models/Style.ts

export class Style {
    constructor(
        public readonly name: string,
        public readonly keyword: string,
        public readonly description: string
    ) {}

    matches(keyword: string): boolean {
        return this.keyword.toLowerCase() === keyword.toLowerCase();
    }
}
```

#### 3.2.2 Domain Services

```typescript
// src/domain/services/ImageGenerationService.ts

export class ImageGenerationService {
    constructor(
        private readonly aiService: IAIService,
        private readonly uploadService: IUploadService,
        private readonly styleRepository: IStyleRepository,
        private readonly meaningRepository: IMeaningRepository,
        private readonly logger: ILogger
    ) {}

    async generateImage(
        user: User,
        broadcaster: string,
        theme?: string,
        styleKeyword?: string
    ): Promise<Image> {
        const trackingId = nanoid(14);
        this.logger.info(`[${trackingId}] Starting image generation for ${user.username}`);

        // 1. Select style
        const style = await this.selectStyle(styleKeyword);
        this.logger.info(`[${trackingId}] Using style: ${style.name}`);

        // 2. Get custom meaning
        const meaning = await this.meaningRepository.getMeaning(user.username)
            ?? user.displayName;

        // 3. Generate AI analysis
        const analysis = await this.aiService.analyzeUsername(
            user.displayName,
            meaning,
            theme
        );
        this.logger.info(`[${trackingId}] AI analysis complete`);

        // 4. Generate image
        const imageData = await this.aiService.generateImage(analysis, style);
        this.logger.info(`[${trackingId}] Image generated`);

        // 5. Upload to CDN
        const uploadedUrl = await this.uploadService.upload(
            imageData.url,
            {
                source: 'twitch',
                channel: broadcaster,
                target: user.username,
                trigger: 'subscribing',
                theme: theme,
                style: style.keyword
            }
        );
        this.logger.info(`[${trackingId}] Image uploaded: ${uploadedUrl}`);

        // 6. Create domain model
        return Image.create(
            uploadedUrl,
            analysis.raw,
            imageData.revisedPrompt,
            {
                source: 'twitch',
                channel: broadcaster,
                target: user.username,
                trigger: 'subscribing',
                theme: theme,
                style: style.keyword
            }
        );
    }

    private async selectStyle(styleKeyword?: string): Promise<Style> {
        if (styleKeyword) {
            const style = await this.styleRepository.findByKeyword(styleKeyword);
            if (style) return style;
        }
        return await this.styleRepository.getRandomStyle();
    }
}
```

#### 3.2.3 Repository Interfaces

```typescript
// src/domain/repositories/IUserRepository.ts

export interface IUserRepository {
    isIgnored(username: string): Promise<boolean>;
    addToIgnoreList(username: string): Promise<void>;
    removeFromIgnoreList(username: string): Promise<void>;
}
```

```typescript
// src/domain/repositories/IImageRepository.ts

export interface IImageRepository {
    save(broadcaster: string, username: string, image: Image): Promise<void>;
    findByUser(broadcaster: string, username: string): Promise<Image[]>;
    findAll(broadcaster: string): Promise<Map<string, Image[]>>;
}
```

```typescript
// src/domain/repositories/IThemeRepository.ts

export interface IThemeRepository {
    save(theme: Theme): Promise<void>;
    findByBroadcaster(broadcaster: string): Promise<Theme | null>;
    remove(broadcaster: string): Promise<boolean>;
}
```

```typescript
// src/domain/repositories/IMeaningRepository.ts

export interface IMeaningRepository {
    save(username: string, meaning: string): Promise<void>;
    getMeaning(username: string): Promise<string | null>;
    remove(username: string): Promise<boolean>;
}
```

```typescript
// src/domain/repositories/IBannedGifterRepository.ts

export interface IBannedGifterRepository {
    ban(broadcaster: string, gifter: string): Promise<void>;
    unban(broadcaster: string, gifter: string): Promise<boolean>;
    isBanned(broadcaster: string, gifter: string): Promise<boolean>;
    getAllForBroadcaster(broadcaster: string): Promise<Set<string>>;
}
```

```typescript
// src/domain/repositories/IStyleRepository.ts

export interface IStyleRepository {
    findAll(): Promise<Style[]>;
    findByKeyword(keyword: string): Promise<Style | null>;
    getRandomStyle(): Promise<Style>;
}
```

---

### 3.3 Application Layer (Use Cases)

```typescript
// src/application/usecases/GenerateImageUseCase.ts

export class GenerateImageUseCase {
    constructor(
        private readonly imageGenerationService: ImageGenerationService,
        private readonly imageRepository: IImageRepository,
        private readonly themeRepository: IThemeRepository,
        private readonly userRepository: IUserRepository,
        private readonly logger: ILogger
    ) {}

    async execute(request: GenerateImageRequest): Promise<GenerateImageResponse> {
        // 1. Check if user is ignored
        if (await this.userRepository.isIgnored(request.username)) {
            this.logger.info(`User ${request.username} is ignored`);
            return {
                success: false,
                reason: 'USER_IGNORED'
            };
        }

        // 2. Get broadcaster theme
        const theme = await this.themeRepository.findByBroadcaster(request.broadcaster);

        // 3. Generate image
        try {
            const user = User.create(request.username, request.displayName);
            const image = await this.imageGenerationService.generateImage(
                user,
                request.broadcaster,
                theme?.description,
                request.style
            );

            // 4. Save image
            await this.imageRepository.save(request.broadcaster, request.username, image);

            return {
                success: true,
                imageUrl: image.url,
                analysis: image.analysis,
                revisedPrompt: image.revisedPrompt
            };
        } catch (error) {
            this.logger.error('Image generation failed', error);
            return {
                success: false,
                reason: 'GENERATION_FAILED',
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
}

export interface GenerateImageRequest {
    username: string;
    displayName: string;
    broadcaster: string;
    style?: string;
}

export interface GenerateImageResponse {
    success: boolean;
    imageUrl?: string;
    analysis?: string;
    revisedPrompt?: string;
    reason?: string;
    error?: string;
}
```

---

### 3.4 Infrastructure Layer

#### 3.4.1 AI Service Implementation

```typescript
// src/infrastructure/services/ai/OpenAIService.ts

export class OpenAIService implements IAIService {
    private readonly client: OpenAI;
    private readonly model: string;
    private readonly systemPromptTemplate: string;

    constructor(
        apiKey: string,
        model: string,
        systemPromptTemplate: string,
        gateway?: string
    ) {
        this.model = model;
        this.systemPromptTemplate = systemPromptTemplate;
        this.client = new OpenAI({
            apiKey,
            baseURL: gateway
        });
    }

    async analyzeUsername(
        username: string,
        meaning: string,
        theme?: string
    ): Promise<UsernameAnalysis> {
        const systemPrompt = this.buildSystemPrompt(theme);
        const queryMessage = this.buildQueryMessage(username, meaning);

        const response = await this.client.beta.chat.completions.parse({
            model: this.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: queryMessage }
            ],
            temperature: 1,
            max_tokens: 700,
            response_format: zodResponseFormat(finalSchema, 'finalSchema')
        });

        const parsed = response.choices[0]?.message.parsed;
        if (!parsed) {
            throw new Error('Failed to parse AI response');
        }

        return {
            step1: parsed.step1,
            step2: parsed.step2,
            raw: JSON.stringify(parsed, null, 2)
        };
    }

    async generateImage(
        analysis: UsernameAnalysis,
        style: Style
    ): Promise<GeneratedImage> {
        // Inject style into analysis
        const promptData = {
            ...analysis.step2,
            style: style.description,
            style_description: style.name
        };

        const prompt = this.buildImagePrompt(promptData);

        const response = await this.client.images.generate({
            model: 'dall-e-3',
            prompt: prompt,
            quality: 'standard',
            size: '1024x1024',
            response_format: 'url'
        });

        const imageData = response.data[0];
        if (!imageData?.url) {
            throw new Error('No image URL returned from DALL-E');
        }

        return {
            url: imageData.url,
            revisedPrompt: imageData.revised_prompt ?? ''
        };
    }

    private buildSystemPrompt(theme?: string): string {
        let prompt = this.systemPromptTemplate.replace(
            '__DATE__',
            new Date().toISOString().slice(0, 10)
        );

        if (theme) {
            const themeBlock = THEME_INSTRUCTION_BLOCK.replace('__THEME__', theme);
            prompt = prompt.replace('__THEME_SECTION__', themeBlock);
        } else {
            prompt = prompt.replace('__THEME_SECTION__', '');
        }

        return prompt.replace(/\n\n\n/g, '\n\n');
    }

    private buildQueryMessage(username: string, meaning: string): string {
        if (meaning !== username) {
            return `Literal username: ${username}\nIntended meaning: ${meaning}`;
        }
        return `Username: ${username}`;
    }

    private buildImagePrompt(data: any): string {
        const jsonData = JSON.stringify(data);
        return DALLE_IMAGE_PROMPT_TEMPLATE.replace('__DATA__', jsonData);
    }
}
```

#### 3.4.2 Storage Service Implementation

```typescript
// src/infrastructure/storage/JsonStorageService.ts

export class JsonStorageService implements IStorageService {
    constructor(
        private readonly dataDir: string,
        private readonly logger: ILogger
    ) {}

    async readJson<T>(filename: string): Promise<T | null> {
        const filePath = path.join(this.dataDir, filename);
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(content) as T;
        } catch (error) {
            if ((error as any).code === 'ENOENT') {
                return null;
            }
            this.logger.error(`Error reading ${filename}`, error);
            throw error;
        }
    }

    async writeJson<T>(filename: string, data: T): Promise<void> {
        const filePath = path.join(this.dataDir, filename);
        try {
            await fs.writeFile(
                filePath,
                JSON.stringify(data, null, 4),
                'utf-8'
            );
        } catch (error) {
            this.logger.error(`Error writing ${filename}`, error);
            throw error;
        }
    }

    async ensureFile(filename: string, defaultContent: string = ''): Promise<void> {
        const filePath = path.join(this.dataDir, filename);
        try {
            await fs.access(filePath);
        } catch {
            await fs.writeFile(filePath, defaultContent, 'utf-8');
        }
    }
}
```

#### 3.4.3 Repository Implementations

```typescript
// src/infrastructure/repositories/JsonThemeRepository.ts

export class JsonThemeRepository implements IThemeRepository {
    private readonly cache: Map<string, Theme> = new Map();
    private readonly filename = 'themes.json';

    constructor(private readonly storage: IStorageService) {}

    async load(): Promise<void> {
        const data = await this.storage.readJson<Record<string, string>>(this.filename);
        if (data) {
            this.cache.clear();
            Object.entries(data).forEach(([broadcaster, description]) => {
                this.cache.set(broadcaster.toLowerCase(), new Theme(broadcaster, description));
            });
        }
    }

    async save(theme: Theme): Promise<void> {
        this.cache.set(theme.broadcaster, theme);
        await this.persist();
    }

    async findByBroadcaster(broadcaster: string): Promise<Theme | null> {
        return this.cache.get(broadcaster.toLowerCase()) ?? null;
    }

    async remove(broadcaster: string): Promise<boolean> {
        const deleted = this.cache.delete(broadcaster.toLowerCase());
        if (deleted) {
            await this.persist();
        }
        return deleted;
    }

    private async persist(): Promise<void> {
        const data: Record<string, string> = {};
        this.cache.forEach((theme, broadcaster) => {
            data[broadcaster] = theme.description;
        });
        await this.storage.writeJson(this.filename, data);
    }
}
```

---

### 3.5 Command System

```typescript
// src/commands/ICommand.ts

export interface ICommand {
    readonly name: string;
    readonly description: string;
    readonly requiresAuth: boolean;

    execute(context: CommandContext): Promise<void>;
}

export interface CommandContext {
    params: string[];
    userName: string;
    userDisplayName: string;
    broadcasterName: string;
    isAdmin: boolean;
    isBroadcaster: boolean;
    reply: (message: string) => Promise<void>;
}
```

```typescript
// src/commands/BaseCommand.ts

export abstract class BaseCommand implements ICommand {
    public abstract readonly name: string;
    public abstract readonly description: string;
    public readonly requiresAuth: boolean = false;

    constructor(protected readonly logger: ILogger) {}

    async execute(context: CommandContext): Promise<void> {
        this.logger.info(
            `Command ${this.name} executed by ${context.userName} in ${context.broadcasterName}`
        );

        if (this.requiresAuth && !context.isAdmin && !context.isBroadcaster) {
            await context.reply('You do not have permission to use this command.');
            return;
        }

        try {
            await this.executeImpl(context);
        } catch (error) {
            this.logger.error(`Command ${this.name} failed`, error);
            await context.reply('An error occurred while executing the command.');
        }
    }

    protected abstract executeImpl(context: CommandContext): Promise<void>;
}
```

```typescript
// src/commands/implementations/SetThemeCommand.ts

export class SetThemeCommand extends BaseCommand {
    public readonly name = 'settheme';
    public readonly description = 'Set a theme for image generation';
    public readonly requiresAuth = true;

    constructor(
        logger: ILogger,
        private readonly themeRepository: IThemeRepository
    ) {
        super(logger);
    }

    protected async executeImpl(context: CommandContext): Promise<void> {
        if (context.params.length === 0) {
            await context.reply('Please provide a theme.');
            return;
        }

        const themeDescription = context.params.join(' ');
        const theme = Theme.create(context.broadcasterName, themeDescription);

        await this.themeRepository.save(theme);

        await context.reply(`Theme set to: ${themeDescription}`);
    }
}
```

```typescript
// src/commands/CommandRegistry.ts

export class CommandRegistry {
    private readonly commands: Map<string, ICommand> = new Map();

    register(command: ICommand): void {
        this.commands.set(command.name.toLowerCase(), command);
    }

    get(commandName: string): ICommand | undefined {
        return this.commands.get(commandName.toLowerCase());
    }

    getAll(): ICommand[] {
        return Array.from(this.commands.values());
    }
}
```

---

### 3.6 Event System

```typescript
// src/events/IEventHandler.ts

export interface IEventHandler<T extends Event = Event> {
    readonly eventType: string;
    handle(event: T): Promise<void>;
}
```

```typescript
// src/events/EventBus.ts

export class EventBus {
    private readonly handlers: Map<string, IEventHandler[]> = new Map();

    constructor(private readonly logger: ILogger) {}

    register(handler: IEventHandler): void {
        const handlers = this.handlers.get(handler.eventType) ?? [];
        handlers.push(handler);
        this.handlers.set(handler.eventType, handlers);
        this.logger.info(`Registered handler for event: ${handler.eventType}`);
    }

    async emit<T extends Event>(event: T): Promise<void> {
        const handlers = this.handlers.get(event.type) ?? [];

        this.logger.debug(`Emitting event: ${event.type}`, event);

        await Promise.all(
            handlers.map(handler =>
                handler.handle(event).catch(error => {
                    this.logger.error(`Handler failed for event ${event.type}`, error);
                })
            )
        );
    }
}
```

```typescript
// src/events/handlers/SubscriptionEventHandler.ts

export class SubscriptionEventHandler implements IEventHandler<SubscriptionEvent> {
    public readonly eventType = 'twitch.subscription';

    constructor(
        private readonly generateImageUseCase: GenerateImageUseCase,
        private readonly messagingService: IMessagingService,
        private readonly logger: ILogger
    ) {}

    async handle(event: SubscriptionEvent): Promise<void> {
        this.logger.info(
            `Processing subscription event for ${event.userName} in ${event.broadcasterName}`
        );

        const response = await this.generateImageUseCase.execute({
            username: event.userName,
            displayName: event.userDisplayName,
            broadcaster: event.broadcasterName
        });

        if (!response.success) {
            await this.messagingService.sendTwitchMessage(
                event.broadcasterName,
                `Thank you @${event.userName}! Unfortunately, I was unable to generate an image.`
            );
            return;
        }

        const verb = event.isGift ? 'gifting' : 'subscribing';

        await Promise.all([
            this.messagingService.sendTwitchMessage(
                event.broadcasterName,
                `Thank you @${event.userName} for ${verb}! Here's your sweatling: ${response.imageUrl}`
            ),
            this.messagingService.sendDiscordMessage(
                `Thank you \`${event.userName}\` for ${verb}. Here's your sweatling: ${response.imageUrl}`
            )
        ]);
    }
}
```

---

### 3.7 Middleware

```typescript
// src/middleware/ThrottleMiddleware.ts

export class ThrottleMiddleware {
    private readonly queues: Map<string, ThrottledQueue> = new Map();

    constructor(private readonly config: ThrottleConfig) {
        this.setupQueues();
    }

    private setupQueues(): void {
        this.queues.set('messages', throttledQueue(
            this.config.messageLimit,
            this.config.messageInterval,
            true
        ));
        this.queues.set('openai', throttledQueue(
            this.config.openaiLimit,
            this.config.openaiInterval,
            true
        ));
        this.queues.set('dalle', throttledQueue(
            this.config.dalleLimit,
            this.config.dalleInterval,
            true
        ));
    }

    async throttle<T>(queueName: string, operation: () => Promise<T>): Promise<T> {
        const queue = this.queues.get(queueName);
        if (!queue) {
            throw new Error(`Unknown throttle queue: ${queueName}`);
        }
        return await queue(operation);
    }

    messageThrottle<T>(operation: () => Promise<T>): Promise<T> {
        return this.throttle('messages', operation);
    }

    openaiThrottle<T>(operation: () => Promise<T>): Promise<T> {
        return this.throttle('openai', operation);
    }

    dalleThrottle<T>(operation: () => Promise<T>): Promise<T> {
        return this.throttle('dalle', operation);
    }
}
```

---

### 3.8 Utilities

```typescript
// src/utils/Logger.ts

export interface ILogger {
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, error?: any): void;
}

export class FileLogger implements ILogger {
    constructor(private readonly logFilePath: string) {}

    debug(message: string, ...args: any[]): void {
        this.log('DEBUG', message, args);
    }

    info(message: string, ...args: any[]): void {
        this.log('INFO', message, args);
    }

    warn(message: string, ...args: any[]): void {
        this.log('WARN', message, args);
    }

    error(message: string, error?: any): void {
        this.log('ERROR', message, error);
    }

    private log(level: string, message: string, data?: any): void {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] [${level}] ${message}`;

        console.log(logLine, data ?? '');

        fs.appendFile(
            this.logFilePath,
            `${logLine} ${data ? JSON.stringify(data) : ''}\n`
        ).catch(err => console.error('Failed to write log', err));
    }
}
```

```typescript
// src/utils/Retry.ts

export class RetryStrategy {
    constructor(
        private readonly maxRetries: number,
        private readonly logger: ILogger
    ) {}

    async execute<T>(
        operation: () => Promise<T>,
        operationName: string = 'operation'
    ): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                if (attempt < this.maxRetries) {
                    this.logger.warn(
                        `${operationName} failed (attempt ${attempt + 1}/${this.maxRetries}), retrying...`,
                        lastError.message
                    );
                } else {
                    this.logger.error(
                        `${operationName} failed after ${this.maxRetries} retries`,
                        lastError
                    );
                }
            }
        }

        throw lastError ?? new Error(`${operationName} failed`);
    }
}
```

---

## 4. Dependency Injection Container

```typescript
// src/core/DependencyContainer.ts

export class DependencyContainer {
    private readonly services: Map<string, any> = new Map();

    register<T>(key: string, factory: () => T): void {
        this.services.set(key, factory());
    }

    registerSingleton<T>(key: string, factory: () => T): void {
        let instance: T | null = null;
        this.services.set(key, () => {
            if (!instance) {
                instance = factory();
            }
            return instance;
        });
    }

    resolve<T>(key: string): T {
        const service = this.services.get(key);
        if (!service) {
            throw new Error(`Service not found: ${key}`);
        }
        return typeof service === 'function' ? service() : service;
    }
}

// Bootstrap function
export function buildContainer(config: Config): DependencyContainer {
    const container = new DependencyContainer();

    // Config
    container.register('config', () => config);

    // Logger
    container.registerSingleton('logger', () =>
        new FileLogger(path.join(config.storage.dataDir, 'log.txt'))
    );

    // Storage
    container.registerSingleton('storage', () =>
        new JsonStorageService(config.storage.dataDir, container.resolve('logger'))
    );

    // Repositories
    container.registerSingleton('themeRepository', () =>
        new JsonThemeRepository(container.resolve('storage'))
    );
    // ... other repositories

    // Services
    container.registerSingleton('aiService', () =>
        new OpenAIService(
            config.openai.apiKey,
            config.openai.model,
            STRUCTURED_OUTPUT_PROMPT,
            config.openai.gateway
        )
    );
    // ... other services

    // Use cases
    container.registerSingleton('generateImageUseCase', () =>
        new GenerateImageUseCase(
            container.resolve('imageGenerationService'),
            container.resolve('imageRepository'),
            container.resolve('themeRepository'),
            container.resolve('userRepository'),
            container.resolve('logger')
        )
    );

    // Commands
    container.register('setThemeCommand', () =>
        new SetThemeCommand(
            container.resolve('logger'),
            container.resolve('themeRepository')
        )
    );
    // ... other commands

    // Command Registry
    container.registerSingleton('commandRegistry', () => {
        const registry = new CommandRegistry();
        registry.register(container.resolve('setThemeCommand'));
        // ... register other commands
        return registry;
    });

    // Event Bus & Handlers
    container.registerSingleton('eventBus', () =>
        new EventBus(container.resolve('logger'))
    );

    // Main Application
    container.registerSingleton('application', () =>
        new Application(
            container.resolve('config'),
            container.resolve('logger'),
            container.resolve('twitchService'),
            container.resolve('discordService'),
            container.resolve('commandRegistry'),
            container.resolve('eventBus')
        )
    );

    return container;
}
```

---

## 5. Simplified index.ts

```typescript
// src/index.ts (NEW SIMPLIFIED VERSION)

import 'dotenv/config';
import { env } from './env';
import { Config } from './core/Config';
import { buildContainer } from './core/DependencyContainer';
import { Application } from './core/Application';

async function main() {
    // 1. Build configuration
    const config = new Config(env);

    // 2. Build dependency container
    const container = buildContainer(config);

    // 3. Get application instance
    const app = container.resolve<Application>('application');

    // 4. Start application
    await app.start();

    // 5. Handle shutdown
    process.on('SIGINT', async () => {
        console.log('Received SIGINT, shutting down...');
        await app.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('Received SIGTERM, shutting down...');
        await app.stop();
        process.exit(0);
    });
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
```

**Result:** index.ts goes from 1003 lines to ~40 lines!

---

## 6. Benefits Summary

### Before (Current)
- ❌ 1003 lines in index.ts
- ❌ Tight coupling between components
- ❌ Global variables everywhere
- ❌ Hard to test
- ❌ Hard to understand
- ❌ Difficult to add new features

### After (Modular)
- ✅ 40 lines in index.ts
- ✅ Loose coupling via interfaces
- ✅ Dependency injection
- ✅ Easy to test (mock interfaces)
- ✅ Clear separation of concerns
- ✅ Easy to add new features

---

*This design document provides the blueprint for the refactored architecture. Implementation will proceed phase by phase according to IMPLEMENTATION_PLAN.md.*

---

## 📝 Real-time Progress Tracking

**⚠️ THIS SECTION TRACKS LIVE IMPLEMENTATION PROGRESS**

This document is updated in real-time as implementation progresses. Implemented modules, design refinements, and architectural decisions are tracked below. This section should always remain at the end of the document.

### Implemented Modules

*No modules implemented yet*

### Design Refinements

*No refinements yet*

### Architectural Decisions

*No decisions logged yet*

---
**Note:** This real-time tracking section should always be the last section of this document. When adding updates, append them in the appropriate subsection above this note.
