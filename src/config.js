/**
 * WATER SPLASH EFFECT CONFIGURATION
 * Adjust these values to fine-tune the water behavior
 */

// ============================================
// PARTICLE SYSTEM
// ============================================
export const MAX_PARTICLES = 500000;      // Maximum number of particles in the system
export const SPAWN_RATE = 12000;          // Particles spawned per frame during splash
export const SDF_RESOLUTION = 96;         // 3D collision grid resolution (64 = fast, 128 = accurate)

// ============================================
// VIDEO SYNC TIMING
// ============================================
export const VIDEO_WAVE_HIT_TIME = 1.3;   // Seconds into video when splash starts
export const VIDEO_WAVE_END_TIME = 2.1;   // Seconds when splash ends (short burst)
export const VIDEO_LOOP_DURATION = 10.0;  // Total video loop length

// ============================================
// SPLASH PHYSICS - Initial Impact
// ============================================
export const SPLASH_VELOCITY_Z = -30;     // Speed toward text (negative = toward screen back)
export const SPLASH_VELOCITY_SPREAD = 15; // Random variation in Z velocity
export const SPLASH_SPREAD_XY = 4;        // Horizontal/vertical scatter on impact
export const SPLASH_UPWARD_BIAS = 3;      // Upward bounce tendency

// ============================================
// BOUNCE VS STICK BEHAVIOR
// ============================================
export const BOUNCE_CHANCE = 0.15;        // 0% = all drops stick, no bounce-off
export const BOUNCE_RESTITUTION_MIN = 0.3;// Minimum energy kept after bounce (30%)
export const BOUNCE_RESTITUTION_MAX = 0.7;// Maximum energy kept after bounce (70%)
export const BOUNCE_SCATTER = 6;          // Random scatter velocity after bounce
export const BOUNCE_DRAG = 0.96;          // Air drag on horizontal movement (lower = more drag)

// ============================================
// STICK & SLIDE TIMING (the slow drip effect)
// ============================================
export const STICK_DURATION_MIN = 3.0;    // Minimum time stuck before sliding (seconds)
export const STICK_DURATION_MAX = 5.0;    // Maximum time stuck (randomized per drop)
export const SLIDE_SPEED_MIN = 0.3;       // Minimum slide speed down letters
export const SLIDE_SPEED_MAX = 0.7;       // Maximum slide speed
export const SLIDE_DURATION_MIN = 5.0;    // Minimum time sliding before dripping (seconds)
export const SLIDE_DURATION_MAX = 10.0;   // Maximum slide time (creates staggered drips)

// ============================================
// DRIPPING - Final Fall
// ============================================
export const DRIP_INITIAL_VELOCITY = -1.0;// Starting fall speed when drip begins
export const DRIP_GRAVITY = -9.8;         // Gravity acceleration
export const DRIP_SHRINK_RATE = 0.03;     // How fast drops shrink while falling (0-1)
export const DRIP_REMOVE_Y = -20;         // Y position where drops are removed (off screen)
export const DRIP_MIN_SIZE = 0.015;       // Minimum size before drop is removed

// ============================================
// DROP SIZES
// ============================================
export const DROP_SIZE_MIN = 0.06;        // Smallest drop size
export const DROP_SIZE_MAX = 0.15;        // Largest drop size
export const BOUNCE_SIZE_REDUCTION = 0.7; // Drops shrink to 70% when bouncing

// ============================================
// VISUAL JITTER (subtle movement while stuck)
// ============================================
export const STICK_JITTER_AMOUNT = 0.0002;// Tiny horizontal wobble while stuck
export const STICK_JITTER_SPEED = 6;      // Speed of wobble animation
