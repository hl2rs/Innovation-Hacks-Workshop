import './MapCityCard.css';

export function createMapCityCardElement(city, onSelect) {
  const card = document.createElement('button');
  card.className = 'map-city-card';
  card.type = 'button';

  if (typeof onSelect === 'function') {
    card.addEventListener('click', onSelect);
  }

  const media = document.createElement('div');
  media.className = 'map-city-card-media';

  const photo = document.createElement('img');
  photo.className = 'map-city-card-photo';
  photo.alt = city.name;
  photo.src =
    city.photoUrl ||
    `https://picsum.photos/seed/map-${encodeURIComponent(city.name)}/200/128`;

  const rankBadge = document.createElement('span');
  rankBadge.className = 'map-city-card-rank';
  rankBadge.textContent = `#${city.popularityRank}`;

  media.appendChild(photo);
  media.appendChild(rankBadge);

  const meta = document.createElement('div');
  meta.className = 'map-city-card-meta';

  const label = document.createElement('p');
  label.className = 'map-city-card-label';

  const name = document.createElement('p');
  name.className = 'map-city-card-name';
  name.textContent = city.name;

  meta.appendChild(label);
  meta.appendChild(name);

  card.appendChild(media);
  card.appendChild(meta);

  return card;
}