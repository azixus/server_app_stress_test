import io from 'socket.io-client'
import colors from 'colors'
import * as Random from './random.js'
import {PerformanceObserver, performance} from 'perf_hooks'
import fs from 'fs'

const HOSTNAME = 'localhost';
const PORT = 8080;
const ADMIN_NAMESPACE = 'admin';
const SOCKET_PATH = '/socket-io';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'pass';
const SERVER_ADDRESS = `http://${HOSTNAME}:${PORT}`

function createDebates(admin, NB_DEBATE) {
    // Start by creating the different debates
    let debatesPromises = [];
    let debates = new Map();
    for (let i = 0; i < NB_DEBATE; ++i) {
        let newDebateObj = {
            title: `Debate${i}`,
            description: `Stress test debate ${i}`
        };

        debatesPromises.push(new Promise(resolve => {
            performance.mark(`Sending newDebate ${i}`);
            admin.emit('newDebate', newDebateObj, (debateId) => {
                performance.mark(`Sent newDebate ${i}`);
                // performance.measure('Time to create a debate',
                //     `Sending newDebate ${i}`,
                //     `Sent newDebate ${i}`);
                debates.set(debateId, {
                    debateId: debateId,
                    clients: [],
                    nbQuestions: 0
                });
                resolve();
            });
        }));
    }
    return Promise.all(debatesPromises)
        .then(() => {
            return debates;
        });
}

function getAdminSocket() {
    const admin = io.connect(`${SERVER_ADDRESS}/${ADMIN_NAMESPACE}`, {
        path: SOCKET_PATH,
        forceNew: true,
        query: {
            username: ADMIN_USERNAME,
            password: ADMIN_PASSWORD
        }
    });

    // Measure question answer performance
    admin.on('questionAnswered', (answer) => {
        let {debateId, questionId} = answer;

        performance.mark(`Question answered ${debateId} ${questionId}`);
        performance.measure('Time to get an answer',
            `Sending newQuestion ${debateId} ${questionId}`,
            `Question answered ${debateId} ${questionId}`);
    });

    return new Promise(resolve => admin.on('connect', () => resolve(admin)));
}

async function connectClients(NB_CLIENTS, debates, uuid) {
    // Connect clients to debate
    let clients = [];
    let clientPromises = [];

    let firstDebate = Math.min(...Array.from(debates.values()).map(d => d.debateId));
    let lastDebate  = Math.max(...Array.from(debates.values()).map(d => d.debateId));

    for (let i = 0; i < NB_CLIENTS; ++i) {
        let debateId = Random.getInteger(firstDebate, lastDebate);
        performance.mark(`Creating client ${uuid}`);
        let client = io.connect(`${SERVER_ADDRESS}/DEBATE-${debateId}`, {
            path: SOCKET_PATH,
            forceNew: true,
            reconnection: false,
            query: {
                uuid: `${uuid}`
            }
        });

        clients.push(client);
        debates.get(debateId).clients.push(client);

        let promise = new Promise(resolve => {
            client.on('connect', () => {
                performance.mark(`Connected ${client.query.uuid}`);
                performance.measure('Time to connect a client',
                    `Creating client ${client.query.uuid}`,
                    `Connected ${client.query.uuid}`);

                // console.log('connected');
                resolve();
            });
        })

        clientPromises.push(promise);

        ++uuid;
    }
    return Promise.all(clientPromises)
        .then(() => {
            return clients;
        });
}

async function sendQuestions(admin, debates, MIN_QUESTIONS_PER_DEBATE, MAX_QUESTIONS_PER_DEBATE) {
    let questionPromises = [];
    for (let [debateId, debate] of debates) {
        const nbQuestions = Random.getInteger(MIN_QUESTIONS_PER_DEBATE, MAX_QUESTIONS_PER_DEBATE);
        for (let question = 1; question <= nbQuestions; ++question) {
            let newQuestionObj = {
                debateId: debateId,
                title: `Question${question}`,
                answers: Random.getAnswers()
            };
            let questionId = ++debate.nbQuestions;

            // console.log('Sending new question.');
            let promise = new Promise(resolve => {
                performance.mark(`Sending newQuestion ${debateId} ${questionId}`);
                admin.emit('newQuestion', newQuestionObj, (res) => {
                    performance.mark(`Sent newQuestion ${debateId} ${questionId}`);
                    performance.measure('Time to send a question',
                        `Sending newQuestion ${debateId} ${questionId}`,
                        `Sent newQuestion ${debateId} ${questionId}`);
                    resolve();
                });
            });

            questionPromises.push(promise);
        }
    }
    await Promise.all(questionPromises);
}

function getDebateIdFromNsp(nsp) {
    return Number.parseInt(nsp.replace(/.*?-(.+)/g, "$1"));
}

function registerClientEvents(clients) {
    // Register events
    for (let client of clients) {
        let debateId = getDebateIdFromNsp(client.nsp);
        client.on('newQuestion', (question) => {
            performance.mark(`Received newQuestion ${debateId} ${question.id} ${client.id}`);
            performance.measure('Time to receive question',
                `Sending newQuestion ${debateId} ${question.id}`,
                `Received newQuestion ${debateId} ${question.id} ${client.id}`);

            let answer = {
                questionId: question.id,
                answerId: Random.getInteger(0, question.answers.length)
            };

            performance.mark(`Sending answerQuestion ${debateId} ${question.id} ${client.id}`);
            client.emit('answerQuestion', answer, (res) => {
                performance.mark(`Sent answerQuestion ${debateId} ${question.id} ${client.id}`);
                performance.measure('Time to answer a question',
                    `Sending answerQuestion ${debateId} ${question.id} ${client.id}`,
                    `Sent answerQuestion ${debateId} ${question.id} ${client.id}`);
            });
        });
    }
}

function writePerformanceToCSV(performance, filename) {
    let csvText = "";
    for (let perf of performance) {
        csvText += `${perf.startTime},${perf.duration}\n`;
    }

    fs.writeFileSync(filename, csvText);
}

const previousResults = new Map();
async function printSummary(start, performances) {
    let totalAvg = 0;

    for (let [key, val] of performances) {
        let avg = val.reduce((acc, curr) => {
            if (curr.startTime >= start)
                return acc + curr.duration;
            return acc;
        }, 0) / val.length;

        if (previousResults.has(key) === false) {
            console.log(`Average ${key} (${val.length}): ${avg}`);
        }
        else if (avg <= previousResults.get(key))
            console.log(`Average ${key} (${val.length}):`, colors.green(`${avg}`));
        else
            console.log(`Average ${key} (${val.length}):`, colors.red(avg.toString()));

        previousResults.set(key, avg);
        totalAvg += avg;
    }

    totalAvg /= performances.size;

    console.log(`Average total time: ${totalAvg}\n`);
}

async function main() {
    const NB_DEBATE = 5;
    const MIN_QUESTIONS_PER_DEBATE = 2;
    const MAX_QUESTIONS_PER_DEBATE = 2;
    const NB_CLIENTS_PER_SECOND = 50;
    const NB_SECOND = 10;

    const admin = await getAdminSocket();

    let performances = new Map();
    const obs = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
            // console.log(`${entry.name}: `, entry.duration);
            let perfEntry = {
                startTime: entry.startTime,
                duration: entry.duration
            };

            if (performances.has(entry.name)) {
                performances.get(entry.name).push(perfEntry);
            } else {
                performances.set(entry.name, [perfEntry]);
            }
        });
    });
    obs.observe({ entryTypes: ['measure'] });
    // obs.observe({ entryTypes: ['measure'], buffered: true });

    console.log('Creating debates...');
    let debates = await createDebates(admin, NB_DEBATE);

    let uuid = 1000;
    let clients = [];
    let i = 0;

    // Connect clients, send question
    await new Promise(resolve => {
        let interval = setInterval(async () => {
            let startTime = performance.now();

            console.log('Creating clients...');
            let clientsAdded = await connectClients(NB_CLIENTS_PER_SECOND, debates, uuid);
            registerClientEvents(clientsAdded);

            clients.push(...clientsAdded);

            console.log('Sending questions...');
            await sendQuestions(admin, debates, MIN_QUESTIONS_PER_DEBATE, MAX_QUESTIONS_PER_DEBATE);
            let endTime = performance.now();

            console.log(`Report ${i}. Start time: ${startTime}, Duration: ${endTime - startTime}`);
            await printSummary(startTime, performances);

            uuid += NB_CLIENTS_PER_SECOND;
            ++i;

            if (i >= NB_SECOND) {
                clearInterval(interval);
                resolve();
            }
        }, 1000);
    });

    console.log('Results:');
    await printSummary(0, performances);

    for (let [key, val] of performances) {
        writePerformanceToCSV(val, 'key.csv');
    }

    admin.close();
    clients.forEach(c => c.close());
}

main()
    .then(r => {
        console.log("Execution terminated.");
    })
    .catch((err) => {
        console.log("Error during script.");
    });


