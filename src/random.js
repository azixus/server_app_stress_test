import Chance from 'chance'
const chance = Chance();

export function getInteger(min, max) {
    return chance.integer({min: min, max: max});
}

export function getSentence() {
    return chance.sentence({words: 4});
}

export function getAnswers(min = 2, max = 5) {
    let nbAnswers = getInteger(min, max);

    let answers = [];
    for (let i = 0; i < nbAnswers; ++i) {
        answers.push(chance.string());
    }

    return answers;
}
