import { z } from 'zod';

export const analysisSchema = z.object({
	reasoning: z.object({
		reasoning_steps: z
			.array(z.string())
			.describe(
				'The reasoning steps leading to the final interpretation. A step is a concise single sentence. Maximum of 3 steps.',
			),
	}),
	interpretation: z.string().describe('The final interpretation of the user input. Concise and to the point.'),
});

export const sceneSchema = z.object({
	themes_ideas: z.array(z.string()),
	subject: z.object({
		facial_expression: z.string(),
		posture: z.string(),
		clothes: z.object({
			type: z.string(),
			attributes: z.array(z.string()),
		}),
		accessories: z.array(z.string()),
		looks: z.string(),
	}),
	objects: z.object({
		banner: z
			.object({
				content: z.string(),
				style: z.string(),
			})
			.describe('A way to show the literal username in the scene'),
		additional_objects: z
			.array(z.string())
			.describe(
				'Objects in the scene that are relevant to the user or action to spice up the scene. A single object is a concise single sentence. Maximum of 3 objects.',
			),
	}),
	scene: z.object({
		setting: z.string(),
		atmosphere: z.string(),
		background: z.string(),
		narrative: z.object({
			subject_action: z
				.string()
				.describe('The action the avatar is performing. Must be relevant to the scene and expressive.'),
		}),
	}),
});

export const finalSchema = z.object({
	step1: analysisSchema.describe('The analysis of the user input.'),
	step2: sceneSchema.describe('The avatar and scene generated based on the analysis.'),
});
