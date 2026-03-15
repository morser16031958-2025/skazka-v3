export type Genre =
  "fairytale" | "animals" | "magic_soft" |
  "magic" | "adventure" | "fantasy";

export type AgeGroup =
  "3-5" | "6-8" | "9-12" | "13+" | "auto";

export interface WorldConfig {
  id: Genre;
  name: string;
  description: string;
  loading_text: string;
  conflictType: "испытание" | "тайна" | "препятствие" | "моральный выбор";
  imageStyleSuffix: string;
  accentColor: string;
}

export const GENRES: Record<Genre, WorldConfig> = {
  fairytale: {
    id: "fairytale",
    name: "Русские народные",
    description: "Жар-птицы, Бабы-яги и тридевятые царства",
    loading_text: "За лесами и морями просыпается старинная сказка, а страницы медленно заполняются чудесами...",
    conflictType: "испытание",
    imageStyleSuffix: "russian folk art, Palekh style, warm gold crimson",
    accentColor: "#b07820",
  },
  animals: {
    id: "animals",
    name: "Про животных",
    description: "Добрые лисы, мудрые совы и храбрые ёжики",
    loading_text: "В лесу загораются светлячки, звери собираются у костра, и история начинает жить...",
    conflictType: "препятствие",
    imageStyleSuffix: "cute animals illustration, warm watercolor, children book",
    accentColor: "#4a8c3f",
  },
  magic_soft: {
    id: "magic_soft",
    name: "Волшебство",
    description: "Феи, единороги и добрые чародеи",
    loading_text: "Лёгкая магия кружит в воздухе, и сказочный мир проявляется строчка за строчкой...",
    conflictType: "тайна",
    imageStyleSuffix: "soft magical fantasy, pastel colors, fairy tale illustration",
    accentColor: "#8855cc",
  },
  magic: {
    id: "magic",
    name: "Магия",
    description: "Тайные миры, академии и древние силы",
    loading_text: "Древние руны вспыхивают, порталы открываются, и тайный мир начинает звучать...",
    conflictType: "тайна",
    imageStyleSuffix: "dark magical fantasy, ethereal lighting, mystical world",
    accentColor: "#5030a0",
  },
  adventure: {
    id: "adventure",
    name: "Приключения",
    description: "Карты, квесты и испытания в пути",
    loading_text: "Компас дрожит, карта раскрывается, и дорога зовёт вперёд...",
    conflictType: "препятствие",
    imageStyleSuffix: "adventure illustration, watercolor map style, vivid colors",
    accentColor: "#1a7850",
  },
  fantasy: {
    id: "fantasy",
    name: "Фантастика",
    description: "Роботы, космос и будущее человечества",
    loading_text: "Звёзды зажигаются, корабли готовятся к старту, и будущее раскрывает сюжет...",
    conflictType: "моральный выбор",
    imageStyleSuffix: "sci-fi illustration, futuristic, space and technology",
    accentColor: "#1a5fa0",
  },
};
