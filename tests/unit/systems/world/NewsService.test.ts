import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { GAME_CONTENT } from '../../../../src/data/content';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { FLAVOR_HEADLINES, NEWS_LIMIT, NewsService } from '../../../../src/systems/world/NewsService';
import { MemoryLogger } from '../../../support/MemoryLogger';

function setup(minutes = 12 * 60) {
  const events = new EventBus<GameEvents>(new MemoryLogger());
  const clock = { minutes };
  const news = new NewsService(ContentCatalog.create(GAME_CONTENT), clock, () => 0.3, events);
  const published: string[] = [];
  events.on('NewsPublished', ({ item }) => published.push(item.key));
  return { news, events, clock, published };
}

describe('NewsService', () => {
  it('opens with the morning paper, and brings it out again as the clock passes 06:00', () => {
    const { news, clock } = setup(23 * 60);
    expect(news.items).toEqual([]);
    news.update();
    expect(news.items).toHaveLength(2);
    expect(news.items.every((item) => /^news\.flavor\.[1-8]$/.test(item.key) && item.cityId !== null)).toBe(true);

    clock.minutes = 2 * 60;
    news.update();
    expect(news.items).toHaveLength(2);
    clock.minutes = 6 * 60 + 1;
    news.update();
    expect(news.items).toHaveLength(4);
    news.update();
    expect(news.items).toHaveLength(4);
    expect(FLAVOR_HEADLINES).toBe(8);
  });

  it('puts the first morning paper under what has already happened', () => {
    const { news, events } = setup();
    events.emit('CityIncidentStarted', { kind: 'fireworks', cityId: 'city_a', x: 0, z: 0 });
    news.update();
    expect(news.items.map((item) => item.key.split('.')[1])).toEqual(['incident', 'flavor', 'flavor']);
  });

  it('breaks the news of a happening near the truck, and says how it ended', () => {
    const { news, events } = setup(18 * 60 + 5);
    events.emit('CityIncidentStarted', { kind: 'building_fire', cityId: 'city_a', x: 0, z: 0 });

    expect(news.latest).toMatchObject({ key: 'news.incident.building_fire', cityId: 'city_a', breaking: true, minuteOfDay: 18 * 60 + 5 });
    events.emit('CityIncidentEnded', { kind: 'building_fire', cityId: 'city_a', caught: false });
    expect(news.latest).toMatchObject({ key: 'news.incidentEnded.building_fire', breaking: false });
    events.emit('CityIncidentEnded', { kind: 'police_chase', cityId: 'city_b', caught: true });
    expect(news.latest?.key).toBe('news.incidentEnded.police_chase.caught');
    events.emit('CityIncidentEnded', { kind: 'police_chase', cityId: 'city_b', caught: false });
    expect(news.latest?.key).toBe('news.incidentEnded.police_chase.escaped');
    // Fireworks end without a word.
    events.emit('CityIncidentEnded', { kind: 'fireworks', cityId: 'city_b', caught: false });
    expect(news.items).toHaveLength(4);
  });

  it('lets each rival boss have their say in their own manner, but not on what happened while the game was closed', () => {
    const { news, events } = setup();
    events.emit('TenderDecided', { missionId: 'm', rivalId: 'rival_demirkent', won: false, prize: 100 });
    expect(news.latest).toMatchObject({ key: 'news.tenderLost.ruthless', rivalId: 'rival_demirkent' });
    events.emit('TenderDecided', { missionId: 'm', rivalId: 'rival_demirkent', won: true, prize: 100 });
    expect(news.items).toHaveLength(1);

    events.emit('CityLeaderChanged', { cityId: 'city_a', previousId: null, leaderId: 'rival_yeniliman', away: false });
    expect(news.latest).toMatchObject({ key: 'news.rivalLeads.flashy', cityId: 'city_a', rivalId: 'rival_yeniliman' });
    events.emit('CampaignRun', { companyId: 'rival_bakirdere', cityId: 'city_d', away: false });
    expect(news.latest).toMatchObject({ key: 'news.campaign.thrifty', cityId: 'city_d' });

    // The company's own doings and the time away are the rivals page's market news.
    events.emit('CityLeaderChanged', { cityId: 'city_a', previousId: null, leaderId: 'player', away: false });
    events.emit('CampaignRun', { companyId: 'player', cityId: 'city_a', away: false });
    events.emit('CampaignRun', { companyId: 'rival_basakova', cityId: 'city_c', away: true });
    expect(news.items).toHaveLength(3);
  });

  it('reports the company\'s levels, the rain and snow coming, and the northern lights', () => {
    const { news, events, published } = setup();
    events.emit('CompanyLevelUp', { level: 4 });
    events.emit('WeatherChanged', { weatherId: 'snow', previousId: 'clear' });
    events.emit('WeatherChanged', { weatherId: 'cloudy', previousId: 'clear' });
    events.emit('SkyWonderSighted', { kind: 'aurora' });
    events.emit('SkyWonderSighted', { kind: 'meteor' });

    expect(published).toEqual(['news.levelUp', 'news.weather.snow', 'news.aurora']);
    expect(news.items[2]).toMatchObject({ key: 'news.levelUp', count: 4 });
  });

  it('clears the last company\'s news when one is started or continued, and brings out a morning paper', () => {
    const { news, events } = setup();
    news.update();
    events.emit('CompanyLevelUp', { level: 7 });
    expect(news.items).toHaveLength(3);

    events.emit('GameStateChanged', { previous: 'driving', current: 'mainMenu' });
    expect(news.items).toHaveLength(3);
    events.emit('GameStateChanged', { previous: 'mainMenu', current: 'driving' });
    expect(news.items).toEqual([]);
    news.update();
    expect(news.items.map((item) => item.key.split('.')[1])).toEqual(['flavor', 'flavor']);
  });

  it('keeps the newest headlines only', () => {
    const { news, events } = setup();
    for (let i = 0; i < NEWS_LIMIT + 5; i++) {
      events.emit('CompanyLevelUp', { level: i });
    }
    expect(news.items).toHaveLength(NEWS_LIMIT);
    expect(news.items[0]!.count).toBe(NEWS_LIMIT + 4);
    expect(news.items.at(-1)!.count).toBe(5);
  });
});
