import db from '../database.js';

const mapSidebarSection = (section) => ({
	id: String(section.id),
	name: section.name,
	position: Number(section.position || 0),
	channelIds: section.channelIds
		? String(section.channelIds)
				.split(',')
				.filter(Boolean)
		: [],
});

export const getSidebarSectionsForUser = (userId) =>
	db
		.prepare(
			`SELECT
        s.id,
        s.name,
        s.position,
        GROUP_CONCAT(i.channelId) AS channelIds
      FROM sidebar_sections s
      LEFT JOIN sidebar_section_items i
        ON i.sectionId = s.id
      WHERE s.userId = ?
      GROUP BY s.id
      ORDER BY s.position ASC, s.id ASC`,
		)
		.all(userId)
		.map(mapSidebarSection);

export const replaceSidebarSectionsForUser = db.transaction((userId, sections = []) => {
	db.prepare(
		`DELETE FROM sidebar_section_items
     WHERE sectionId IN (SELECT id FROM sidebar_sections WHERE userId = ?)`,
	).run(userId);
	db.prepare('DELETE FROM sidebar_sections WHERE userId = ?').run(userId);

	const insertSection = db.prepare(
		`INSERT INTO sidebar_sections (userId, name, position)
     VALUES (?, ?, ?)`,
	);
	const insertItem = db.prepare(
		`INSERT INTO sidebar_section_items (sectionId, channelId, position)
     VALUES (?, ?, ?)`,
	);

	sections.forEach((section, sectionIndex) => {
		const result = insertSection.run(
			userId,
			String(section?.name || '').trim() || `Section ${sectionIndex + 1}`,
			sectionIndex,
		);
		const sectionId = result.lastInsertRowid;
		const channelIds = Array.isArray(section?.channelIds)
			? [...new Set(section.channelIds.map(String).filter(Boolean))]
			: [];

		channelIds.forEach((channelId, itemIndex) => {
			insertItem.run(sectionId, channelId, itemIndex);
		});
	});

	return getSidebarSectionsForUser(userId);
});
