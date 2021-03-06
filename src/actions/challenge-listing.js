/**
 * Challenge listing actions.
 */

import _ from 'lodash';
import { createActions } from 'redux-actions';
import { decodeToken } from 'tc-accounts';
import 'isomorphic-fetch';
import { processSRM, COMPETITION_TRACKS } from '../utils/tc';
import { services } from '../services';
import { errors } from '../utils';
import * as filterUtil from '../utils/challenge/filter';
import * as config from '../config';

const { fireErrorMessage } = errors;
const { getService } = services.challenge;
const { getReviewOpportunitiesService } = services.reviewOpportunities;
const { PAGE_SIZE, REVIEW_OPPORTUNITY_PAGE_SIZE } = config;

/**
 * Process filter
 * When filter includes Data Science track, still should be
 * included DEVELOP_MARATHON_MATCH sub track.
 * @param filter
 * @returns {string}
 */
function processFilter(filter) {
  const newFilter = _.clone(filter);
  if (_.has(filter, 'track')
    && filter.track.includes(COMPETITION_TRACKS.DATA_SCIENCE.toUpperCase())
    && ((_.has(filter, 'subTrack') && !filter.subTrack.includes('DEVELOP_MARATHON_MATCH'))
    || !_.has(filter, 'subTrack'))
  ) {
    newFilter.subTrack = `${_.has(filter, 'subTrack') ? `${newFilter.subTrack},DEVELOP_MARATHON_MATCH` : 'DEVELOP_MARATHON_MATCH'}`;
    newFilter.track = _.remove(filter.track.split(','), item => item.toUpperCase() !== COMPETITION_TRACKS.DATA_SCIENCE.toUpperCase()).join(',');

    if (_.isEmpty(newFilter.track)) {
      delete newFilter.track;
    }
  }
  return newFilter;
}

/**
 * Private. Loads from the backend all challenges matching some conditions.
 * @param {Function} getter Given params object of shape { limit, offset }
 *  loads from the backend at most "limit" challenges, skipping the first
 *  "offset" ones. Returns loaded challenges as an array.
 * @param {Number} page Optional. Next page of challenges to load.
 * @param {Array} prev Optional. Challenges loaded so far.
 */
function getAll(getter, page = 0, prev) {
  /* Amount of challenges to fetch in one API call. 50 is the current maximum
   * amount of challenges the backend returns, event when the larger limit is
   * explicitely required. */
  return getter({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }).then((res) => {
    if (res.challenges.length === 0) {
      return prev || res;
    }
    // parse challenges and meta
    let current = {};
    if (prev) {
      current.challenges = prev.challenges.concat(res.challenges);
      current.meta = res.meta;
    } else {
      current = res;
    }
    return page === 0 ? current : getAll(getter, 1 + page, current);
  });
}

/**
 * Gets possible challenge subtracks.
 * @return {Promise}
 */
function getChallengeSubtracksDone() {
  return getService()
    .getChallengeSubtracks()
    .then(res => res.sort((a, b) => a.name.localeCompare(b.name)));
}

/**
 * Gets possible challenge tags (technologies).
 * @return {Promise}
 */
function getChallengeTagsDone() {
  return getService()
    .getChallengeTags()
    .then(res => res.map(item => item.name)
      .sort((a, b) => a.localeCompare(b)));
}

/**
 * Notifies about reloading of all active challenges. The UUID is stored in the
 * state, and only challenges fetched by getAllActiveChallengesDone action with
 * the same UUID will be accepted into the state.
 * @param {String} uuid
 * @param {String} page
 * @param {Object} frontFilter
 * @param {String} sort
 * @param {String} bucket
 * @return {String}
 */
function getActiveChallengesInit(uuid, page, frontFilter, sort, bucket) {
  return {
    uuid, page, frontFilter, sort, bucket,
  };
}

/** TODO: Inspect if the 2 actions bellow can be removed?
 * They do  duplicate what is done in `getActiveChallengesDone` but fetch all challenges
 * which was refactored in listing-improve
 */
function getAllActiveChallengesInit(uuid) {
  return uuid;
}
function getAllActiveChallengesDone(uuid, tokenV3) {
  const filter = { status: 'ACTIVE' };
  const service = getService(tokenV3);
  const calls = [
    getAll(params => service.getChallenges(filter, params)),
  ];
  let user;
  if (tokenV3) {
    user = decodeToken(tokenV3).handle;
    // Handle any errors on this endpoint so that the non-user specific challenges
    // will still be loaded.
    calls.push(getAll(params => service.getUserChallenges(user, filter, params)
      .catch(() => ({ challenges: [] }))));
  }
  return Promise.all(calls).then(([ch, uch]) => {
    /* uch array contains challenges where the user is participating in
@@ -111,8 +124,8 @@ function getAllActiveChallengesDone(uuid, tokenV3) {
     * challenges in an efficient way. */
    if (uch) {
      const map = {};
      uch.challenges.forEach((item) => { map[item.id] = item; });
      ch.challenges.forEach((item) => {
        if (map[item.id]) {
          /* It is fine to reassing, as the array we modifying is created just
           * above within the same function. */
          /* eslint-disable no-param-reassign */
          item.users[user] = true;
          item.userDetails = map[item.id].userDetails;
          /* eslint-enable no-param-reassign */
        }
      });
    }

    return {
      uuid,
      challenges: ch.challenges,
      handle: user,
    };
  });
}

/**
 * Gets 1 page of active challenges (including marathon matches) from the backend.
 * Once this action is completed any active challenges saved to the state before
 * will be dropped, and the newly fetched ones will be stored there.
 * Loading of all challenges wil start in background.
 * @param {String} uuid
 * @param {Number} page
 * @param {Object} backendFilter Backend filter to use.
 * @param {String} tokenV3 Optional. Topcoder auth token v3. Without token only
 *  public challenges will be fetched. With the token provided, the action will
 *  also fetch private challenges related to this user.
 * @param {Object} frontFilter
 * @param {String} sort
 * @param {String} bucket

 * @return {Promise}
 */
function getActiveChallengesDone(
  uuid, page, backendFilter, tokenV3, frontFilter = {}, sort, bucket,
) {
  const filter = processFilter({
    ...backendFilter,
    status: 'ACTIVE',
  });

  const service = getService(tokenV3);
  const calls = [
    service.getChallenges(filter, {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
  ];
  let user;
  if (tokenV3) {
    user = decodeToken(tokenV3).handle;
    // Handle any errors on this endpoint so that the non-user specific challenges
    // will still be loaded.
    calls.push(getAll(
      params => service.getUserChallenges(user, filter, params).catch(() => ({ challenges: [] })),
    ));
  }
  return Promise.all(calls).then(([ch, uch]) => {
    // let fullCH = ch;
    /* uch array contains challenges where the user is participating in
     * some role. The same challenge are already listed in res array, but they
     * are not attributed to the user there. This block of code marks user
     * challenges in an efficient way. */
    if (uch) {
      const map = {};
      uch.challenges.forEach((item) => { map[item.id] = item; });
      ch.challenges.forEach((item) => {
        if (map[item.id]) {
          /* It is fine to reassing, as the array we modifying is created just
           * above within the same function. */
          /* eslint-disable no-param-reassign */
          item.users[user] = true;
          item.userDetails = map[item.id].userDetails;
          /* eslint-enable no-param-reassign */
        }
      });
    }

    let { challenges, meta } = ch;
    // filter by date range and re-compute meta
    // we can safely remove the next two lines when backend support date range
    challenges = filterUtil.filterByDate(challenges, frontFilter);
    meta = filterUtil.newMeta(meta, challenges, frontFilter);
    return {
      uuid,
      handle: tokenV3 ? user : null,
      challenges,
      meta,
      frontFilter,
      sort,
      bucket,
      tokenV3,
    };
  });
}

/**
 * Init loading of all challenges
 * @param {String} uuid
 */
function getRestActiveChallengesInit(uuid) {
  return { uuid };
}

/**
 * Loading all challenges
 * @param {String} uuid
 * @param {String} tokenV3
 * @param {Object} backendFilter
 * @param {Object} frontFilter
 * @param {String} sort
 * @param {String} bucket
 */
function getRestActiveChallengesDone(
  uuid, tokenV3, backendFilter, frontFilter, sort, bucket,
) {
  const filter = processFilter({
    ...backendFilter,
    status: 'ACTIVE',
  });

  const service = getService(tokenV3);
  const calls = [
    getAll(params => service.getChallenges(filter, params), 1),
  ];
  let user;
  if (tokenV3) {
    user = decodeToken(tokenV3).handle;
    calls.push(getAll(params => service.getUserChallenges(user, filter, params)
      .catch(() => ({ challenges: [] }))), 1);
  }
  return Promise.all(calls).then(([ch, uch]) => {
    /* uch array contains challenges where the user is participating in
     * some role. The same challenge are already listed in res array, but they
     * are not attributed to the user there. This block of code marks user
     * challenges in an efficient way. */
    if (uch) {
      const map = {};
      uch.challenges.forEach((item) => { map[item.id] = item; });
      ch.challenges.forEach((item) => {
        if (map[item.id]) {
          /* It is fine to reassing, as the array we modifying is created just
           * above within the same function. */
          /* eslint-disable no-param-reassign */
          item.users[user] = true;
          item.userDetails = map[item.id].userDetails;
          /* eslint-enable no-param-reassign */
        }
      });
    }

    let { challenges } = ch;
    // filter by date range and re-compute meta
    // we can safely remove the next two lines when backend support date range
    challenges = filterUtil.filterByDate(challenges, frontFilter);
    const meta = filterUtil.newMeta(undefined, challenges, frontFilter);

    return {
      uuid,
      handle: tokenV3 ? user : null,
      challenges,
      frontFilter,
      meta,
      sort,
      bucket,
    };
  });
}

/**
 * Notifies the state that we are about to load the specified page of past
 * challenges.
 * @param {String} uuid
 * @param {Number} page
 * @param {Object} frontFilter
 * @param {String} sort
 * @return {Object}
 */
function getPastChallengesInit(uuid, page, frontFilter, sort) {
  return {
    uuid,
    page,
    frontFilter,
    sort,
  };
}

/**
 * Gets the specified page of past challenges (including MMs).
 * @param {String} uuid
 * @param {Number} page Page of challenges to fetch.
 * @param {Object} filter Backend filter to use.
 * @param {String} tokenV3 Optional. Topcoder auth token v3.
 * @param {Object} frontFilter Optional. Original frontend filter.
 * @param {String} sort
 * @return {Object}
 */
function getPastChallengesDone(uuid, page, filter, tokenV3, frontFilter = {}, sort) {
  const service = getService(tokenV3);
  const newFilter = processFilter({
    ...filter,
    status: 'COMPLETED',
  });
  return service.getChallenges(newFilter, {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }).then(({ challenges }) => ({
    uuid,
    challenges,
    frontFilter,
    sort,
  }));
}

/**
 * Action to get a list of currently open Review Opportunities using V3 API
 * @param {String} uuid Unique identifier for init/donen instance from shortid module
 * @param {Number} page Page of review opportunities to fetch.
 * @param {String} tokenV3 Optional.
 * @param {String} sort Optional.
 * @param {Object} frontFilter Optional.
 * @return {Object} Action object
 */
function getReviewOpportunitiesDone(uuid, page, tokenV3, sort, frontFilter = {}) {
  return getReviewOpportunitiesService(tokenV3)
    .getReviewOpportunities(REVIEW_OPPORTUNITY_PAGE_SIZE, page * REVIEW_OPPORTUNITY_PAGE_SIZE)
    .then(loaded => ({
      uuid, loaded, sort, frontFilter,
    }))
    .catch((error) => {
      fireErrorMessage('Error Getting Review Opportunities', error.content || error);
      return Promise.reject(error);
    });
}

/**
 * Payload creator for the action that inits the loading of SRMs.
 * @param {String} uuid
 * @return {String}
 */
function getSrmsInit(uuid) {
  return uuid;
}

/**
 * Payload creator for the action that loads SRMs.
 * @param {String} uuid
 * @param {String} handle
 * @param {Object} params
 * @param {String} tokenV3
 */
function getSrmsDone(uuid, handle, params, tokenV3) {
  const service = getService(tokenV3);
  const promises = [service.getSrms(params)];
  if (handle) {
    promises.push(service.getUserSrms(handle, params));
  }
  return Promise.all(promises).then((data) => {
    let srms = data[0];
    const userSrms = data[1];
    const userSrmsMap = {};
    _.forEach(userSrms, (srm) => {
      userSrmsMap[srm.id] = srm;
    });
    srms = _.map(srms, (srm) => {
      if (userSrmsMap[srm.id]) {
        return processSRM(srm);
      }
      return srm;
    });
    return { uuid, data: srms };
  });
}

export default createActions({
  CHALLENGE_LISTING: {
    DROP_CHALLENGES: bucket => ({ bucket }),

    GET_MORE_CHALLENGES: bucket => ({ bucket }),

    GET_ALL_ACTIVE_CHALLENGES_INIT: getAllActiveChallengesInit,
    GET_ALL_ACTIVE_CHALLENGES_DONE: getAllActiveChallengesDone,

    GET_ACTIVE_CHALLENGES_INIT: getActiveChallengesInit,
    GET_ACTIVE_CHALLENGES_DONE: getActiveChallengesDone,

    GET_REST_ACTIVE_CHALLENGES_INIT: getRestActiveChallengesInit,
    GET_REST_ACTIVE_CHALLENGES_DONE: getRestActiveChallengesDone,

    GET_CHALLENGE_SUBTRACKS_INIT: _.noop,
    GET_CHALLENGE_SUBTRACKS_DONE: getChallengeSubtracksDone,

    GET_CHALLENGE_TAGS_INIT: _.noop,
    GET_CHALLENGE_TAGS_DONE: getChallengeTagsDone,

    GET_PAST_CHALLENGES_INIT: getPastChallengesInit,
    GET_PAST_CHALLENGES_DONE: getPastChallengesDone,

    GET_REVIEW_OPPORTUNITIES_INIT: (uuid, page, sort) => ({ uuid, page, sort }),
    GET_REVIEW_OPPORTUNITIES_DONE: getReviewOpportunitiesDone,

    GET_SRMS_INIT: getSrmsInit,
    GET_SRMS_DONE: getSrmsDone,

    EXPAND_TAG: id => id,

    /* Pass in community ID. */
    SELECT_COMMUNITY: _.identity,

    SET_FILTER: _.identity,

    SET_DATEPICKER_STATUS: status => ({ status }),

    SET_SORT: (bucket, sort) => ({ bucket, sort }),
  },
});
