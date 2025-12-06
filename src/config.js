/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WATER SPLASH EFFECT - MASTER CONFIGURATION
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This file controls ALL aspects of the water splash effect.
 * Each setting has examples showing what happens when you change it.
 * 
 * TIP: Start with small changes and reload to see the effect!
 */

// ════════════════════════════════════════════════════════════════════════════════
// PARTICLE SYSTEM - Core Performance Settings
// ════════════════════════════════════════════════════════════════════════════════

/**
 * MAX_PARTICLES - Total particles that can exist at once
 * 
 * WHAT YOU'LL SEE:
 *   100,000  → Sparse water, fast on any device
 *   500,000  → Good density, smooth on mid-range GPUs
 *   1,000,000 → Dense water coverage, needs good GPU
 *   2,000,000 → Ultra dense, cinematic quality (high-end GPU only)
 * 
 * EXAMPLES:
 *   Low-end laptop: use 200,000
 *   Gaming PC: use 1,000,000 - 2,000,000
 */
export const MAX_PARTICLES = 2000000;

/**
 * SPAWN_RATE - How many particles spawn per frame during splash
 * 
 * WHAT YOU'LL SEE:
 *   5,000   → Gentle splash, like light rain
 *   15,000  → Medium splash, balanced look
 *   30,000  → Heavy splash, like a bucket of water
 *   50,000  → Massive splash, waterfall intensity
 * 
 * NOTE: Higher values fill up MAX_PARTICLES faster
 */
export const SPAWN_RATE = 55000;

/**
 * SDF_RESOLUTION - 3D collision grid accuracy
 * 
 * WHAT YOU'LL SEE:
 *   64  → Fast generation, slight collision imprecision on thin letters
 *   96  → Good balance (recommended)
 *   128 → Very accurate, slower generation
 *   160 → Ultra precise, for complex fonts with fine details
 * 
 * NOTE: Generation time scales with resolution³ (128 is 8x slower than 64)
 */
export const SDF_RESOLUTION = 128;


// ════════════════════════════════════════════════════════════════════════════════
// VIDEO SYNC TIMING - When the splash happens
// ════════════════════════════════════════════════════════════════════════════════

/**
 * VIDEO_WAVE_HIT_TIME - When splash starts (seconds into video)
 * 
 * Adjust this to match your video's wave hitting the text.
 */
export const VIDEO_WAVE_HIT_TIME = 1.3;

/**
 * VIDEO_WAVE_END_TIME - When splash stops (seconds into video)
 * 
 * WHAT YOU'LL SEE:
 *   Short duration (0.5s): Quick splash burst
 *   Long duration (2s+): Sustained water flow
 */
export const VIDEO_WAVE_END_TIME = 2.1;

/**
 * VIDEO_LOOP_DURATION - Total video length for looping
 */
export const VIDEO_LOOP_DURATION = 10.0;


// ════════════════════════════════════════════════════════════════════════════════
// SPLASH PHYSICS - Initial Water Impact
// ════════════════════════════════════════════════════════════════════════════════

/**
 * SPLASH_VELOCITY_Z - Speed toward text (negative = toward screen back)
 * 
 * WHAT YOU'LL SEE:
 *   -15  → Slow, gentle splash
 *   -28  → Medium impact (default)
 *   -45  → Fast, aggressive splash
 *   -60  → Violent impact, lots of spray
 */
export const SPLASH_VELOCITY_Z = -32;

/**
 * SPLASH_VELOCITY_SPREAD - Random variation in impact speed
 * 
 * WHAT YOU'LL SEE:
 *   5   → Uniform splash, all drops hit at similar speed
 *   12  → Natural variation
 *   25  → Chaotic, some drops much faster than others
 */
export const SPLASH_VELOCITY_SPREAD = 14;

/**
 * SPLASH_SPREAD_XY - How wide the splash spreads horizontally/vertically
 * 
 * WHAT YOU'LL SEE:
 *   1   → Narrow stream, like a hose
 *   3.5 → Natural splash width
 *   8   → Wide spray, covers more area
 */
export const SPLASH_SPREAD_XY = 4.0;

/**
 * SPLASH_UPWARD_BIAS - Tendency for drops to bounce upward
 * 
 * WHAT YOU'LL SEE:
 *   0   → Drops fall immediately after impact
 *   2.5 → Natural upward spray
 *   6   → Exaggerated fountain effect
 */
export const SPLASH_UPWARD_BIAS = 3.0;


// ════════════════════════════════════════════════════════════════════════════════
// BOUNCE VS STICK - What happens when drops hit the letters
// ════════════════════════════════════════════════════════════════════════════════

/**
 * BOUNCE_CHANCE - Probability a drop bounces vs sticks (0 to 1)
 * 
 * WHAT YOU'LL SEE:
 *   0.1  → Most drops stick immediately, minimal spray
 *   0.35 → Balanced mix of spray and coverage
 *   0.6  → Lots of spray, less sticking
 *   0.9  → Almost all drops bounce off, like hitting glass
 */
export const BOUNCE_CHANCE = 0.4;

/**
 * BOUNCE_RESTITUTION_MIN/MAX - Energy kept after bounce (0 to 1)
 * 
 * WHAT YOU'LL SEE:
 *   Low (0.1-0.2)  → Soft bounce, drops lose energy quickly
 *   Medium (0.3-0.5) → Natural water behavior
 *   High (0.6-0.8) → Bouncy, like rubber balls
 */
export const BOUNCE_RESTITUTION_MIN = 0.15;
export const BOUNCE_RESTITUTION_MAX = 0.5;

/**
 * BOUNCE_SCATTER - Random scatter velocity after bounce
 * 
 * WHAT YOU'LL SEE:
 *   2   → Drops bounce in predictable directions
 *   4   → Natural scatter
 *   10  → Chaotic spray in all directions
 */
export const BOUNCE_SCATTER = 5;

/**
 * BOUNCE_SCATTER_VERTICAL - Extra upward scatter for spray effect
 * 
 * WHAT YOU'LL SEE:
 *   2   → Spray stays low
 *   6   → Natural upward spray
 *   12  → Tall fountain spray
 */
export const BOUNCE_SCATTER_VERTICAL = 7;

/**
 * BOUNCE_DRAG - Air resistance on bouncing drops (0.9 to 1)
 * 
 * WHAT YOU'LL SEE:
 *   0.85 → Heavy drag, drops slow quickly (foggy day)
 *   0.94 → Natural air resistance
 *   0.99 → Almost no drag, drops fly far (space-like)
 */
export const BOUNCE_DRAG = 0.93;

/**
 * IMPACT_SPRAY_FACTOR - How much impact speed affects spray angle
 * 
 * WHAT YOU'LL SEE:
 *   0.05 → Minimal radial spray
 *   0.12 → Natural radial splash pattern
 *   0.25 → Exaggerated starburst spray
 */
export const IMPACT_SPRAY_FACTOR = 0.15;


// ════════════════════════════════════════════════════════════════════════════════
// STICK & SLIDE - The slow drip effect on letters
// ════════════════════════════════════════════════════════════════════════════════

/**
 * STICK_DURATION_MIN/MAX - How long drops stay stuck before sliding (seconds)
 * 
 * WHAT YOU'LL SEE:
 *   0.5-1   → Quick slide, water runs off fast
 *   3-5     → Natural delay before sliding
 *   8-15    → Water clings to letters for a long time
 */
export const STICK_DURATION_MIN = 2.5;
export const STICK_DURATION_MAX = 6.0;

/**
 * SLIDE_SPEED_MIN/MAX - How fast drops slide down letters
 * 
 * WHAT YOU'LL SEE:
 *   0.1-0.3 → Slow, viscous slide (honey-like)
 *   0.3-0.7 → Natural water slide
 *   1.0-2.0 → Fast slide, water races down
 */
export const SLIDE_SPEED_MIN = 0.25;
export const SLIDE_SPEED_MAX = 0.8;

/**
 * SLIDE_DURATION_MIN/MAX - How long drops slide before dripping off (seconds)
 * 
 * WHAT YOU'LL SEE:
 *   1-3   → Quick drip, water falls off fast
 *   5-10  → Natural slide duration
 *   15-25 → Water slides for a long time, trails down letters
 */
export const SLIDE_DURATION_MIN = 4.0;
export const SLIDE_DURATION_MAX = 12.0;


// ════════════════════════════════════════════════════════════════════════════════
// DRIPPING - Final Fall Off Letters
// ════════════════════════════════════════════════════════════════════════════════

/**
 * DRIP_INITIAL_VELOCITY - Starting fall speed when drip begins
 * 
 * WHAT YOU'LL SEE:
 *   0    → Drop starts stationary, slowly accelerates
 *   -1   → Small initial velocity (natural)
 *   -5   → Drop is already falling when it detaches
 */
export const DRIP_INITIAL_VELOCITY = -0.8;

/**
 * DRIP_GRAVITY - Gravity strength (negative = downward)
 * 
 * WHAT YOU'LL SEE:
 *   -5   → Slow motion, moon gravity
 *   -9.8 → Earth gravity (realistic)
 *   -20  → Heavy gravity, drops fall fast
 */
export const DRIP_GRAVITY = -12;

/**
 * DRIP_SHRINK_RATE - How fast drops shrink while falling (0 to 1)
 * 
 * WHAT YOU'LL SEE:
 *   0    → Drops maintain size while falling
 *   0.03 → Subtle shrink (evaporation effect)
 *   0.1  → Drops visibly shrink as they fall
 */
export const DRIP_SHRINK_RATE = 0.025;

/**
 * DRIP_REMOVE_Y - Y position where drops are removed (off screen)
 */
export const DRIP_REMOVE_Y = -20;

/**
 * DRIP_MIN_SIZE - Minimum size before drop is removed
 */
export const DRIP_MIN_SIZE = 0.01;


// ════════════════════════════════════════════════════════════════════════════════
// DROP SIZES - Visual appearance of water droplets
// ════════════════════════════════════════════════════════════════════════════════

/**
 * DROP_SIZE_MIN/MAX - Size range for water drops
 * 
 * WHAT YOU'LL SEE:
 *   0.02-0.08 → Fine mist, many tiny drops
 *   0.04-0.14 → Natural water drops
 *   0.08-0.25 → Large, visible drops (cartoon-like)
 */
export const DROP_SIZE_MIN = 0.03;
export const DROP_SIZE_MAX = 0.16;

/**
 * BOUNCE_SIZE_REDUCTION - How much drops shrink when bouncing (0 to 1)
 * 
 * WHAT YOU'LL SEE:
 *   0.8  → Drops barely shrink when bouncing
 *   0.5  → Drops shrink to half size (creates mist)
 *   0.2  → Drops become tiny mist particles
 */
export const BOUNCE_SIZE_REDUCTION = 0.45;

/**
 * MIST_SIZE_FACTOR - Additional shrink for high-speed impacts
 * 
 * WHAT YOU'LL SEE:
 *   0.1  → Minimal mist from fast impacts
 *   0.3  → Natural mist generation
 *   0.5  → Lots of fine mist spray
 */
export const MIST_SIZE_FACTOR = 0.35;


// ════════════════════════════════════════════════════════════════════════════════
// VISUAL JITTER - Subtle movement while stuck to letters
// ════════════════════════════════════════════════════════════════════════════════

/**
 * STICK_JITTER_AMOUNT - Tiny wobble while stuck (surface tension simulation)
 * 
 * WHAT YOU'LL SEE:
 *   0       → Drops are perfectly still when stuck
 *   0.0002  → Subtle shimmer (realistic)
 *   0.001   → Visible wobble (stylized)
 */
export const STICK_JITTER_AMOUNT = 0.0003;

/**
 * STICK_JITTER_SPEED - Speed of the wobble animation
 * 
 * WHAT YOU'LL SEE:
 *   3   → Slow, lazy wobble
 *   6   → Natural frequency
 *   15  → Fast vibration
 */
export const STICK_JITTER_SPEED = 8;


// ════════════════════════════════════════════════════════════════════════════════
// VISUAL RENDERING - Appearance of water drops
// ════════════════════════════════════════════════════════════════════════════════

/**
 * WATER_COLOR - Base color of water drops (RGB, 0-1)
 * 
 * EXAMPLES:
 *   [0.3, 0.5, 0.9]  → Ocean blue
 *   [0.4, 0.7, 1.0]  → Light sky blue
 *   [0.2, 0.8, 0.6]  → Tropical teal
 *   [0.9, 0.2, 0.3]  → Red (blood effect)
 *   [1.0, 0.8, 0.2]  → Gold/yellow
 */
export const WATER_COLOR = [0.35, 0.55, 0.95];

/**
 * WATER_OPACITY - Base transparency of drops (0 = invisible, 1 = solid)
 * 
 * WHAT YOU'LL SEE:
 *   0.4 → Very transparent, ghostly water
 *   0.7 → Semi-transparent (realistic water)
 *   1.0 → Solid colored drops
 */
export const WATER_OPACITY = 0.85;

/**
 * FRESNEL_STRENGTH - Edge glow/rim lighting intensity
 * 
 * WHAT YOU'LL SEE:
 *   0   → No edge highlight
 *   0.4 → Subtle rim light
 *   1.0 → Strong glowing edges (dramatic)
 */
export const FRESNEL_STRENGTH = 0.5;

/**
 * SPECULAR_INTENSITY - Brightness of light reflections
 * 
 * WHAT YOU'LL SEE:
 *   0.2 → Matte finish, minimal shine
 *   0.6 → Natural water shine
 *   1.2 → Very shiny, like glass
 */
export const SPECULAR_INTENSITY = 0.8;

/**
 * DEPTH_FADE - Whether drops fade when far from camera
 * 
 * WHAT YOU'LL SEE:
 *   true  → Distant drops become transparent (realistic)
 *   false → All drops equally visible
 */
export const DEPTH_FADE = true;

/**
 * DEPTH_FADE_DISTANCE - Distance at which drops start fading
 * 
 * WHAT YOU'LL SEE:
 *   5   → Aggressive fade, only nearby drops visible
 *   15  → Natural depth fade
 *   30  → Subtle fade, most drops visible
 */
export const DEPTH_FADE_DISTANCE = 20;

/**
 * SIZE_ATTENUATION - Whether drops shrink with distance
 * 
 * WHAT YOU'LL SEE:
 *   true  → Realistic 3D perspective (far drops smaller)
 *   false → All drops same screen size (stylized)
 */
export const SIZE_ATTENUATION = true;


// ════════════════════════════════════════════════════════════════════════════════
// QUALITY PRESETS - Quick settings for different hardware
// ════════════════════════════════════════════════════════════════════════════════
// Uncomment ONE preset to use it, or customize individual values above

// LOW QUALITY (Mobile/Laptop):
// export const MAX_PARTICLES = 200000;
// export const SPAWN_RATE = 8000;
// export const SDF_RESOLUTION = 64;

// MEDIUM QUALITY (Default):
// export const MAX_PARTICLES = 500000;
// export const SPAWN_RATE = 15000;
// export const SDF_RESOLUTION = 96;

// HIGH QUALITY (Gaming PC):
// export const MAX_PARTICLES = 1500000;
// export const SPAWN_RATE = 25000;
// export const SDF_RESOLUTION = 96;

// ULTRA QUALITY (High-end GPU):
// export const MAX_PARTICLES = 3000000;
// export const SPAWN_RATE = 40000;
// export const SDF_RESOLUTION = 128;
