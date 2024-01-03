const cheers = {
	'broadcaster': 'dunkorslam',
	'users': [
		{
			'user': 'imrllykool',
			'cheers': 100,
		},
		{
			'user': 'chostings',
			'cheers': 400,
		},
		{
			'user': 'darkmatter_synthesis',
			'cheers': 300,
		},
		{
			'user': 'dislikemehh',
			'cheers': 400,
		},
		{
			'user': 'myndzi',
			'cheers': 1000,
		},
		{
			'user': 'kazabubu42',
			'cheers': 100,
		},
		{
			'user': 'oolivero45',
			'cheers': 100,
		},
		{
			'user': 'roguefalcon43',
			'cheers': 300,
		},
		{
			'user': 'sacukel',
			'cheers': 100,
		},
		{
			'user': 'vandil_the_rogue',
			'cheers': 700,
		},
		{
			'user': 'nickstick',
			'cheers': 100,
		},
		{
			'user': 'stalebread117',
			'cheers': 200,
		},
		{
			'user': 'kittyclaw_',
			'cheers': 200,
		},
		{
			'user': 'mysterywavi',
			'cheers': 200,
		},
		{
			'user': 'haphast',
			'cheers': 1500,
		},
		{
			'user': 'aswip_',
			'cheers': 300,
		},
		{
			'user': 'drainl0rd',
			'cheers': 700,
		},
		{
			'user': 'dfearthereaper',
			'cheers': 10000,
		},
		{
			'user': 'asteriskx',
			'cheers': 300,
		},
		{
			'user': 'majimahugo',
			'cheers': 400,
		},
		{
			'user': 'gregbadabinski',
			'cheers': 100,
		},
		{
			'user': 'stephfei',
			'cheers': 100,
		},
		{
			'user': 'mcjizzle_',
			'cheers': 100,
		},
		{
			'user': 'jeremy5909jmoney',
			'cheers': 100,
		},
		{
			'user': 'tabmoc',
			'cheers': 200,
		},
		{
			'user': 'conga_lyne',
			'cheers': 200,
		},
		{
			'user': 'fractalchaos087',
			'cheers': 200,
		},
		{
			'user': 'larandar',
			'cheers': 1600,
		},
		{
			'user': 'metalmigo',
			'cheers': 200,
		},
		{
			'user': 'tapshell',
			'cheers': 100,
		},
		{
			'user': 'jeffunk',
			'cheers': 100,
		},
		{
			'user': 'lasiace',
			'cheers': 800,
		},
		{
			'user': 'lukas39415',
			'cheers': 100,
		},
		{
			'user': 'vexilus_',
			'cheers': 200,
		},
		{
			'user': 'trendoffender',
			'cheers': 250,
		},
		{
			'user': 'engreth_',
			'cheers': 100,
		},
	],
};

interface User {
	user: string;
	cheers: number;
}

interface Cheer {
	broadcaster: string;
	users: User[];
}

const calculateSummary = (cheers: Cheer[]): string => {
	return cheers
		.map(
			(cheer) =>
				`${cheer.users.length} users for a total of ${cheer.users.reduce(
					(acc, user) => acc + user.cheers,
					0,
				)} cheers`,
		)
		.join('\n');
};

const findHighestCheerer = (cheers: Cheer[]): { highestCheerer: string; highestCheer: number } => {
	let highestCheerer = '';
	let highestCheer = 0;

	for (const cheer of cheers) {
		for (const user of cheer.users) {
			if (user.cheers > highestCheer) {
				highestCheerer = user.user;
				highestCheer = user.cheers;
			}
		}
	}

	return { highestCheerer, highestCheer };
};

const cheers: { cheers: Cheer[] } = {};

const summary = calculateSummary(cheers.cheers);
const { highestCheerer, highestCheer } = findHighestCheerer(cheers.cheers);

console.log(summary);
console.log(`Highest cheerer: ${highestCheerer} with ${highestCheer} bits`);
