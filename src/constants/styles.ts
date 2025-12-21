export type DalleTemplate = {
	name: string;
	keyword: string;
	description: string;
};

export const DALLE_TEMPLATES: DalleTemplate[] = [
	{
		name: 'oil painting',
		keyword: 'oil',
		description:
			'Emphasizing rich, textured brush strokes and dramatic lighting, invoking the feel of traditional oil painting.',
	},
	{
		name: 'watercolor',
		keyword: 'watercolor',
		description:
			'Soft, fluid backgrounds with gentle transitions and delicate washes, creating an ethereal and dreamy atmosphere. Subtle textures emphasize organic imperfections.',
	},
	{
		name: 'pixel art',
		keyword: 'pixel',
		description: 'Blocky and crisp with sharp lines and vibrant colors, evoking a retro, 16-bit pixel art style.',
	},
	{
		name: 'glitch art illustration',
		keyword: 'glitch',
		description:
			'Vibrant neon colors with jagged distortions and digital artifacts, creating a chaotic and futuristic atmosphere.',
	},
	{
		name: 'Neon graffiti mural',
		keyword: 'neon',
		description:
			'A glowing neon graffiti mural painted on a dark, gritty brick wall. Intense, fluorescent colors pop against the rough, textured urban surface. The style features spray paint drips, glowing outlines, and a high-contrast street art aesthetic that looks like it is illuminated by blacklight.',
	},
	{
		name: 'Byzantine art illustration',
		keyword: 'byzantine',
		description:
			'Flat, gilded backgrounds and highly stylized, geometric forms evoke the opulence and sacred symbolism of Byzantine art. Intricate patterns and jewel-like color contrasts add richness and reverence to the scene.',
	},
	{
		name: 'expressionism drawing',
		keyword: 'expressionism',
		description:
			'Exaggerated lines and intense colors that convey heightened emotions and subjective experience.',
	},
	{
		name: 'charcoal drawing',
		keyword: 'charcoal',
		description:
			'Monochromatic shading with rough, textured lines, emphasizing stark contrasts and sketch-like detail. The main subject stands out in vivid color against the black and white environment.',
	},
	{
		name: 'Delicate pastel illustration',
		keyword: 'pastel_illustration',
		description:
			'A delicate and soft illustration style inspired by nostalgic Japanese aesthetics. This style features minimalist lines, subtle gradients, and pastel-like tones, evoking a calm, approachable atmosphere. The artwork avoids anime tropes and emphasizes unique, playful elements, such as distinct features like blue skin, while retaining a cozy and charming aesthetic.',
	},
	{
		name: '1980s Anime Style',
		keyword: 'anime80s',
		description:
			'A high-quality single snapshot of a 1980s anime frame. Vibrant colors, cel shading, and nostalgic aesthetics. Soft, fluid lines and expressive character designs with a classic, hand-drawn broadcast feel.',
	},
	{
		name: '90s Sci-Fi Anime Style',
		keyword: 'anime90s',
		description:
			'A single cinematic snapshot of a 90s sci-fi anime frame. Sleek, angular character designs with thin, precise linework. A distinct broadcast aesthetic with slender proportions, cool color tones, and a slightly psychological atmosphere.',
	},
	{
		name: 'fauvism painting',
		keyword: 'fauvism',
		description: 'Bold, vibrant colors with expressive brushstrokes, emphasizing abstraction and emotional intensity.',
	},
	{
		name: 'flat design illustration',
		keyword: 'flat',
		description: 'Simplified shapes and bold colors, creating a clean and modern flat design aesthetic.',
	},
	{
		name: 'sketch art',
		keyword: 'sketch',
		description: 'Loose, rough lines with an emphasis on expressive, hand-drawn quality and organic textures.',
	},
	{
		name: 'Pop Art Comic',
		keyword: 'popart',
		description:
			'A 1960s comic-book pop-art style with bold black contour lines, flat saturated primary colors, and dense halftone dot shading. Facial features are expressive, stylized, and slightly exaggerated, capturing a dramatic mid-panel moment. The composition is clean and graphic with strong pop-art energy and vintage print charm. The artwork must be full-bleed — no borders.',
	},
	{
		name: 'Vinyl Record Cover',
		keyword: 'vinyl',
		description:
			'An album cover presented as a physical vinyl record sleeve zoomed in close-up, showing the entire square front cover without cropping. The design features bold, striking imagery suitable for a music album. The composition mimics professional product photography with realistic lighting, shadows, and surface textures like cardboard grain and delicate wear. The artwork must be full-bleed — no borders.',
	},
	{
		name: 'Romanticism landscape painting',
		keyword: 'romanticism',
		description:
			"Sweeping, emotional landscapes with bold, atmospheric effects. Romanticism emphasizes the sublime, portraying nature's grandeur and humanity's smallness. Dynamic skies, rugged mountains, and turbulent seas dominate, using rich, textured brushstrokes to create epic, evocative scenery.",
	},
	{
		name: 'Art Nouveau stained glass',
		keyword: 'art_nouveau',
		description:
			'Elegant compositions with sweeping organic curves and flowing natural forms. Rich jewel tones blend with delicate patterns inspired by botanical motifs. Ornate decorative elements and graceful linework create an atmosphere of refined beauty and sophisticated grandeur.',
	},
	{
		name: 'Classical fresco painting',
		keyword: 'fresco',
		description:
			'A pristine, freshly painted classical fresco. Vibrant mineral pigments applied to clean lime plaster create a luminous, matte finish. The colors are bright and distinct, featuring rich blues, reds, and golds, capturing the breathtaking grandeur of a masterpiece in its original, unweathered state.',
	},
	{
		name: 'Art Deco illustration',
		keyword: 'art_deco',
		description:
			'Geometric shapes and streamlined forms with metallic gold and silver accents. Symmetrical compositions featuring stepped forms and sunburst patterns create a sense of luxury and modern sophistication.',
	},
	{
		name: 'Ukiyo-e woodblock print',
		keyword: 'ukiyoe',
		description:
			'Ukiyo-e woodblock print',
	},
	{
		name: 'Vaporwave illustration',
		keyword: 'vaporwave',
		description:
			'Surreal compositions with bold gradients and glowing neon elements. Retro-futuristic elements blend with geometric patterns in saturated purple and teal tones.',
	},
	{
		name: 'Risograph print',
		keyword: 'risograph',
		description:
			'Two-tone compositions with slight misalignment and textural grain. Vibrant spot colors overlap to create unexpected combinations with a distinctive printed quality.',
	},
	{
		name: 'Gouache painting',
		keyword: 'gouache',
		description:
			'Matte, opaque colors with smooth transitions and precise edges. Rich pigments blend seamlessly while maintaining crisp details and bold graphic qualities.',
	},
	{
		name: '90s TV Ad',
		keyword: 'tvad90s',
		description:
			'A vibrant, high-energy 1990s television commercial screenshot. Saturated colors, slightly soft VHS definition, and dynamic camera angles. The scene radiates enthusiastic, cheesy marketing energy with a classic broadcast aesthetic.',
	},
	{
		name: 'Acrylic painting',
		keyword: 'acrylic',
		description:
			'Vivid, textured surfaces with bold brushstrokes and vibrant colors. Thick impasto layers create dynamic textures and expressive mark-making.',
	},
];
