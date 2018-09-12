'use strict';

const joi = require('joi');
const boom = require('boom');

const SCHEMA_EVENT_ID = joi.number().integer().positive().label('Event ID');
const SCHEMA_CACHE_NAME = joi.string().label('Cache Name');
const DEFAULT_BYTES = 1024 * 1024 * 1024; // 1GB

exports.plugin = {
    name: 'events',

    /**
     * Events Plugin
     * @method  register
     * @param  {Hapi}     server                Hapi Server
     * @param  {Object}   options               Configuration
     * @param  {Integer}  options.maxByteSize   Maximum Bytes to accept
     */
    register(server, options) {
        const cache = server.cache({});

        server.expose('stats', cache.stats);
        server.route([{
            method: 'GET',
            path: '/events/{id}/{cacheName}',
            handler: async (request, h) => {
                const { eventId } = request.auth.credentials;
                const eventIdParam = request.params.id;
                const cacheName = request.params.cacheName;
                const cacheKey = {
                    segment: `events/${eventIdParam}`,
                    id: cacheName
                };

                if (eventIdParam !== eventId) {
                    return boom.forbidden(`Credential only valid for ${eventId}`);
                }

                let value;

                try {
                    value = await cache.get(cacheKey);
                } catch (err) {
                    throw err;
                }

                if (!value) {
                    throw boom.notFound();
                }

                let response;

                if (value.c) {
                    response = h.response(Buffer.from(value.c.data));
                    response.headers = value.h;
                } else {
                    response = h.response(Buffer.from(value));
                    response.headers['content-type'] = 'text/plain';
                }

                return response;
            },
            options: {
                description: 'Read event cache',
                notes: 'Get a specific cached object from an event',
                tags: ['api', 'events'],
                auth: {
                    strategies: ['token'],
                    scope: ['build']
                },
                plugins: {
                    'hapi-swagger': {
                        security: [{ token: [] }]
                    }
                },
                validate: {
                    params: {
                        id: SCHEMA_EVENT_ID,
                        cacheName: SCHEMA_CACHE_NAME
                    }
                }
            }
        }, {
            method: 'PUT',
            path: '/events/{id}/{cache*}',
            handler: async (request, h) => {
                const { username } = request.auth.credentials;
                const eventId = request.params.id;
                const cache = request.params.cache;
                const id = `${eventId}-${cache}`;
                const contents = {
                    c: request.payload,
                    h: {}
                };
                const size = Buffer.byteLength(request.payload);
                let value = contents;

                if (username !== eventId) {
                    return boom.forbidden(`Credential only valid for ${username}`);
                }

                // Store all x-* and content-type headers
                Object.keys(request.headers).forEach((header) => {
                    if (header.indexOf('x-') === 0 || header === 'content-type') {
                        contents.h[header] = request.headers[header];
                    }
                });

                // For text/plain payload, upload it as Buffer
                if (contents.h['content-type'] === 'text/plain') {
                    value = contents.c;
                }

                request.log(eventId, `Saving ${cache} of size ${size} bytes with `
                    + `headers ${JSON.stringify(contents.h)}`);

                try {
                    await cache.set(id, value, 0);
                } catch (err) {
                    request.log([id, 'error'], `Failed to store in cache: ${err}`);

                    throw boom.serverUnavailable(err.message, err);
                }

                return h.response().code(202);
            },
            options: {
                description: 'Write event cache',
                notes: 'Write a cache object from a specific event',
                tags: ['api', 'events'],
                payload: {
                    maxBytes: parseInt(options.maxByteSize, 10) || DEFAULT_BYTES,
                    parse: false
                },
                auth: {
                    strategies: ['token'],
                    scope: ['event']
                },
                plugins: {
                    'hapi-swagger': {
                        security: [{ token: [] }]
                    }
                },
                validate: {
                    params: {
                        id: SCHEMA_EVENT_ID,
                        cache: SCHEMA_CACHE_ID
                    }
                }
            }
        }]);
    }
};
