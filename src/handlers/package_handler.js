/**
 * @module package_handler
 * @desc Endpoint Handlers in all relating to the packages themselves.
 * @implements {common_handler}
 * @implements {users}
 * @implements {data}
 * @implements {collection}
 * @implements {query}
 * @implements {git}
 * @implements {logger}
 * @implements {error}
 * @implements {config}
 */

const common = require("./common_handler.js");
const users = require("../users.js");
const data = require("../data.js");
const collection = require("../collection.js");
const query = require("../query.js");
const git = require("../git.js");
const logger = require("../logger.js");
const error = require("../error.js");
const { server_url, paginated_amount } = require("../config.js").GetConfig();
const utils = require("../utils.js");

/**
 * @async
 * @function GETPackages
 * @desc Endpoint to return all packages to the user. Based on any filtering
 * theyved applied via query parameters.
 * @param {object} req - The `Request` object inherited from the Express endpoint.
 * @param {object} res - The `Response` object inherited from the Express endpoint.
 */
async function GETPackages(req, res) {
  // GET /api/packages
  let params = {
    page: query.page(req),
    sort: query.sort(req),
    direction: query.dir(req),
  };

  let all_packages = await data.GetAllPackages();
  console.log("retreived all packages");

  if (!all_packages.ok) {
    await common.HandleError(req, res, all_packages);
    return;
  }

  // Now we have all_packages.content which is an array of every package
  // we will then need to organize this list, according to our params.
  // additionally remove any fields that are not natively shown to the end user.
  // And finally we would need to modify our headers, to include links for current, next, and last.
  let packages = await collection.DeepCopy(all_packages.content); // We need to use a deep copy here, to avoid
  // making changes to the cached package data within data.
  packages = await collection.Sort(all_packages.content, params.sort);
  packages = await collection.Direction(packages, params.direction);

  // Now with packages sorted in the right direction, lets prune the results.
  let total_pages = Math.ceil(packages.length / paginated_amount);
  if (params.page !== 1) {
    packages.splice(0, params.page * paginated_amount); // Remove from the start to however many packages, should be visible.
  }
  if (params.page !== total_pages) {
    packages.splice(
      params.page * paginated_amount + paginated_amount,
      packages.length
    );
    // Start after our paginated items, and remove till the end, as long as we aren't on the last page.
  }
  packages = await collection.POSPrune(packages); // Use the Package Object Short Prune
  // One note of concern with chaining all of these together, is that this will potentially loop
  // through the entire array of packages 3 times, resulting in a
  // linear time complexity of O(3). But testing will have to determine how much that is a factor of concern.

  res.append(
    "Link",
    `<${server_url}/api/packages?page=${params.page}&sort=${
      params.sort
    }&order=${
      params.direction
    }>; rel="self", <${server_url}/api/packages?page=${total_pages}&sort=${
      params.sort
    }&order=${
      params.direction
    }>; rel="last", <${server_url}/api/packages?page=${params.page++}&sort=${
      params.sort
    }&order=${params.direction}>; rel="next"`
  );

  res.status(200).json(packages);
  logger.HTTPLog(req, res);
}

/**
 * @async
 * @function POSTPackages
 * @desc This endpoint is used to publish a new package to the backend server.
 * Taking the repo, and your authentication for it, determines if it can be published,
 * then goes about doing so.
 * @param {object} req - The `Request` object inherited from the Express endpoint.
 * @param {object} res - The `Response` object inherited from the Express endpoint.
 */
async function POSTPackages(req, res) {
  // POST /api/packages
  let params = {
    repository: query.repo(req),
    auth: req.get("Authorization"),
  };

  let user = await users.VerifyAuth(params.auth);

  // Check authentication.
  if (!user.ok) {
    await common.HandleError(req, res, user);
    return;
  }

  // Check repository format validity.
  if (params.repository === "") {
    // The repository format is invalid.
    await common.BadRepoJSON(req, res);
    return;
  }

  // Now here we need to check several things for a new package:
  // - The package doesn't exist.
  // - The user is the proper owner of the repo they are attempting to link to.

  // To see if the package already exists, we will utilize our data.GetPackagePointerByName
  // to hope it returns an error, that the package doesn't exist, and will avoid reading the package file itself.
  // currently though, the repository, is `owner/repo` meanwhile GetPackagePointerByName expects just `repo`
  let exists = await data.GetPackagePointerByName(
    params.repository.split("/")[1]
  );

  if (exists.ok) {
    // The package exists.
    error.PublishPackageExists(res);
    logger.HTTPLog(req, res);
    return;
  }

  // Even further though we need to check that the error is not found, since errors here can bubble.
  if (exists.short !== "Not Found") {
    // The server failed for some other bubbled reason, and is now encountering an error.
    await common.HandleError(req, res, exists);
    return;
  }

  // Now we know the package doesn't exist. And we want to check that the user owns this repo on git.
  let gitowner = await git.Ownership(user.content, params.repository);

  if (!gitowner.ok) {
    await common.HandleError(req, res, gitowner);
    return;
  }

  // Now knowing they own the git repo, and it doesn't exist here, lets publish.
  let pack = await git.CreatePackage(params.repository);

  if (!pack.ok) {
    await common.HandleError(req, res, pack);
    return;
  }

  // Now with valid package data, we can pass it along.
  let create = await data.NewPackage(pack.content);

  if (!create.ok) {
    await common.HandleError(req, res, create);
    return;
  }

  // The package has been successfully created.
  // And we want to now do a small test, and grab the new package to return it.
  let new_pack = await data.GetPackageByName(pack.content.name);

  if (!new_pack.ok) {
    // We were unable to get the new package, and should return an error.
    await common.HandleError(req, res, new_pack);
    return;
  }

  new_pack = await collection.POFPrune(new_pack.content); // Package Object Full Prune before return.
  res.status(201).json(new_pack);
}

async function GETPackagesFeatured(req, res) {
  // GET /api/packages/featured
  // https://github.com/atom/apm/blob/master/src/featured.coffee
  // Returns featured packages, but its unknown how these are determined.
  // At least currently just returns 6 items. No link headers or anything fancy like that.
  // Just Package Object Short array
  // Supports engine query parameter.
  // Assumption: This utlizies a mystery rating system to return only themes. Allowing specificity
  // into versions that are currently compatible.
  // Returns a 200 response if everything goes well.
  // Sort by package name, in alphabetical order is implemented client side. Wether this means we want to implement it
  // or leave it to the client is hard to say.

  // See https://github.com/confused-Techie/atom-community-server-backend-JS/issues/23

  // As of now, it seems that currently there is no rating system, the featured packages
  // were manually choosen by the atom team. While in the future there are plans
  // to have an automatic rating system to determine featured packages,
  // for now we will do the same. If only to reach feature parity quicker.
  let col = await data.GetFeatured();

  if (!col.ok) {
    await common.HandleError(req, res, col);
    return;
  }

  let newCol = await collection.DeepCopy(col.content);
  newCol = await collection.POSPrune(newCol);

  res.status(200).json(newCol);
}

/**
 * @async
 * @function GETPackagesSearch
 * @desc Allows user to search through all packages. Using their specified
 * query parameter.
 * @param {object} req - The `Request` object inherited from the Express endpoint.
 * @param {object} res - The `Response` object inherited from the Express endpoint.
 */
async function GETPackagesSearch(req, res) {
  // GET /api/packages/search
  let params = {
    sort: query.sort(req, "relevance"),
    page: query.page(req),
    direction: query.dir(req),
    query: query.query(req),
  };

  let all_packages = await data.GetAllPackages();

  if (!all_packages.ok) {
    await common.HandleError(req, res, all_packages);
    return;
  }

  let packages = await collection.DeepCopy(all_packages.content);
  packages = await collection.SearchWithinPackages(params.query, packages);
  packages = await collection.Sort(packages, params.sort);
  packages = await collection.Direction(packages, params.direction);
  // Now that the packages are sorted in the proper direction, we
  // need to exempt results, according to our pagination.
  let total_pages = Math.ceil(packages.length / paginated_amount);
  // ^^^ We need to get the total before we start splicing and dicing.
  if (params.page !== 1) {
    packages.splice(0, params.page * paginated_amount);
    // Remove from the start to however many packages, should be visible on previous pages.
  }
  if (params.page !== total_pages) {
    packages.splice(
      params.page * paginated_amount + paginated_amount,
      packages.length
    );
    // This will start after our paginated options, and remove till the
    // end of the array, since we aren't on the last page.
  }
  packages = await collection.POSPrune(packages); // Package Object Short Prune.

  // now to get headers.
  res.append(
    "Link",
    `<${server_url}/api/packages/search?q=${params.query}&page=${
      params.page
    }&sort=${params.sort}&order=${
      params.direction
    }>; rel="self", <${server_url}/api/packages?q=${
      params.query
    }&page=${total_pages}&sort=${params.sort}&order=${
      params.direction
    }>; rel="last", <${server_url}/api/packages/search?q=${
      params.query
    }&page=${params.page++}&sort=${params.sort}&order=${
      params.direction
    }>; rel="next"`
  );

  res.status(200).json(packages);
  logger.HTTPLog(req, res);
}

async function GETPackagesDetails(req, res) {
  // GET /api/packages/:packageName
  let params = {
    engine: query.engine(req),
    name: decodeURIComponent(req.params.packageName),
  };
  let pack = await data.GetPackageByName(params.name);

  if (!pack.ok) {
    await common.HandleError(req, res, pack);
    return;
  }

  // From here we now have the package and just want to prune data from it
  pack = await collection.DeepCopy(pack);
  pack = await collection.POFPrune(pack.content); // package object full prune

  if (params.engine) {
    // query.engine returns false if no valid query param is found.
    // before using EngineFilter we need to check the truthiness of it.
    pack = await collection.EngineFilter(pack, params.engine);
  }

  res.status(200).json(pack);
  logger.HTTPLog(req, res);
}

/**
 * @async
 * @function DELETEPackagesName
 * @desc Allows the user to delete a repo they have ownership of.
 * @param {object} req - The `Request` object inherited from the Express endpoint.
 * @param {object} res - The `Response` object inherited from the Express endpoint.
 */
async function DELETEPackagesName(req, res) {
  // DELETE /api/packages/:packageName
  let params = {
    auth: req.get("Authorization"),
    packageName: decodeURIComponent(req.params.packageName),
  };
  let user = await users.VerifyAuth(params.auth);

  if (!user.ok) {
    await common.HandleError(req, res, user);
    return;
  }

  let gitowner = await git.Ownership(user.content, params.packageName);

  if (!gitowner.ok) {
    await common.HandleError(req, res, gitowner);
    return;
  }

  // they are logged in properly, and own the git repo they are referencing via the package name.
  // Now we can delete the package.
  let rm = await data.RemovePackageByName(params.packageName);

  if (!rm.ok) {
    await common.HandleError(req, res, rm);
    return;
  }

  // we have successfully removed the package.
  res.status(204).json({ message: "Success" });
  logger.HTTPLog(req, res);
}

async function POSTPackagesStar(req, res) {
  // POST /api/packages/:packageName/star
  let params = {
    auth: req.get("Authorization"),
    packageName: decodeURIComponent(req.params.packageName),
  };
  let user = await users.VerifyAuth(params.auth);

  if (user.ok) {
    // with user.ok we already know the user has valid authentication credentails, and we can allow changes.
    let pack = await data.StarPackageByName(
      params.packageName,
      user.content.name
    );

    if (pack.ok) {
      // now with staring the package successfully, we also want to add this package to the user list stars.
      let star = await users.AddUserStar(params.packageName, user.content.name);
      // this lets us add the star to the users profile.
      if (star.ok) {
        // now that we know the star has been added to the users profile, we can return the package, with success
        res.status(200).json(pack.content);
        logger.HTTPLog(req, res);
      } else {
        // the users star was not applied properly to their profile, and we would likely want to remove their star from the package before returning.
        let unstar = await data.UnStarPackageByName(
          params.packageName,
          user.content.name
        );

        if (unstar.ok) {
          // since it still failed to star as originally intended, return error.
          await common.ServerError(req, res, star.content);
        } else {
          // unstarring after a failed staring, failed again. Oh jeez...
          error.ServerErrorJSON(res);
          logger.HTTPLog(req, res);
          logger.ErrorLog(
            req,
            res,
            "Failed to unstar package after failing to add star to user. Unstar error, followed by User Star error to follow..."
          );
          logger.ErrorLog(req, res, unstar.content);
          logger.ErrorLog(req, res, star.content);
        }
      }
    } else {
      // the users star was not applied properly to the package, and we can return without further action.
      await common.ServerError(req, res, pack.content);
    }
  } else {
    await common.AuthFail(req, res, user);
  }
}

async function DELETEPackagesStar(req, res) {
  // DELETE /api/packages/:packageName/star
  let params = {
    auth: req.get("Authorization"),
    packageName: decodeURIComponent(req.params.packageName),
  };

  const onLogin = async (user) => {
    // now to unstar the package, by first removing the users star from the package.
    let pack = await data.UnStarPackageByName(
      params.packageName,
      user.content.name
    );

    if (!pack.ok) {
      await common.HandleError(req, res, pack);
      return;
    }
    // we have removed the star from the package, then remove from the user.
    let unstar = await users.RemoveUserStar(
      params.packageName,
      user.content.name
    );

    if (!unstar.ok) {
      // BUT important to note, the star was already removed from the package itself, so this means the package doesn't
      // list the user, but the user still lists the package, so we would need to restar the package
      // to allow this whole flow to try again, else it will fail to unstar the package on a second attempt, leaving the user
      // no way to actually remove the star later on.
      let restar = await data.StarPackageByName(
        params.packageName,
        user.content.name
      );

      if (restar.ok) {
        await common.ServerError(req, res, unstar.content);
        return;
      }

      // We failed to restar the package after failing to unstar the user, rough...
      error.ServerErrorJSON(res);
      logger.HTTPLog(req, res);
      logger.ErrorLog(
        req,
        res,
        "Failed to restar the package, after failing to unstar the user. Unstar logs followed by Restar logs..."
      );
      logger.ErrorLog(req, res, unstar.content);
      logger.ErrorLog(req, res, restar.content);
      return;
    }

    // now the star is successfully removed from the user, and from the package.
    res.status(201).send();
  };

  await utils.LocalUserLoggedIn(req, res, params.auth, onLogin);
}

/**
 * @async
 * @function GETPackagesStargazers
 * @desc Endpoint returns the array of `star_gazers` from a specified package.
 * Taking only the package wanted, and returning it directly.
 * @param {object} req - The `Request` object inherited from the Express endpoint.
 * @param {object} res - The `Response` object inherited from the Express endpoint.
 */
async function GETPackagesStargazers(req, res) {
  // GET /api/packages/:packageName/stargazers
  let params = {
    packageName: decodeURIComponent(req.params.packageName),
  };
  let pack = await data.GetPackageByName(params.packageName);

  if (!pack.ok) {
    await common.HandleError(req, res, pack);
    return;
  }

  // then we can just directly return the star_gazers object
  res.status(200).json(pack.content.star_gazers);
  logger.HTTPLog(req, res);
}

/**
 * @async
 * @function POSTPackagesVersion
 * @desc Allows a new version of a package to be published. But also can allow
 * a user to rename their application during this process.
 * @param {object} req - The `Request` object inherited from the Express endpoint.
 * @param {object} res - The `Response` object inherited from the Express endpoint.
 */
async function POSTPackagesVersion(req, res) {
  // POST /api/packages/:packageName/versions
  let params = {
    tag: query.tag(req),
    rename: query.rename(req),
    auth: req.get("Authorization"),
    packageName: decodeURIComponent(req.params.packageName),
  };

  const onLogin = async (user) => {
    let gitowner = await git.Ownership(user.content, params.packageName);

    if (!gitowner.ok) {
      await common.HandleError(req, res, gitowner);
      return;
    }

    // TODO: Unkown how to handle a rename, so it must be planned before completion.
    await common.NotSupported(req, res);
  };

  await utils.LocalUserLoggedIn(req, res, params.auth, onLogin);
}

async function GETPackagesVersion(req, res) {
  // GET /api/packages/:packageName/versions/:versionName
  let params = {
    packageName: decodeURIComponent(req.params.packageName),
    versionName: req.params.versionName,
  };
  // To ensure the version we have been handed is a valid SemVer, we can pass it through the query.engine filter
  // if we get the same object back, we know its valid.
  if (params.versionName == query.engine(params.versionName)) {
    // Now we know the version is a valid semver.
    let pack = await data.GetPackageByName(params.packageName);

    if (pack.ok) {
      // now with the package itself, lets see if that version is a valid key within in the version obj.
      if (pack.content.versions[params.versionName]) {
        // the version does exist, lets return it.
        // Now additionally, we need to add a link to the tarball endpoint.
        pack.content.versions[params.versionName].dist = {
          tarball: `${server_url}/api/packages/${params.packageName}/versions/${params.versionName}/tarball`,
        };

        // now we can return the modified object.
        res.status(200).json(pack.content.versions[params.versionName]);
        logger.HTTPLog(req, res);
      } else {
        // the version does not exist, return 404
        await common.NotFound(req, res);
      }
    } else {
      await common.HandleError(req, res, pack);
    }
  } else {
    // we return a 404 for the version, since its an invalid format.
    await common.NotFound(req, res);
  }
}

/**
 * @async
 * @function GETPackagesVersionTarball
 * @desc Allows the user to get the tarball for a specific package version.
 * Which should initiate a download of said tarball on their end.
 * @param {object} req - The `Request` object inherited from the Express endpoint.
 * @param {object} res - The `Response` object inherited from the Express endpoint.
 */
async function GETPackagesVersionTarball(req, res) {
  // GET /api/packages/:packageName/versions/:versionName/tarball
  let params = {
    packageName: decodeURIComponent(req.params.packageName),
    versionName: query.engine(req.params.versionName),
  };
  // Now that migration has began we know that each version will have
  // a tarball_url key on it, linking directly to the tarball from gh for that version.

  // we initially want to ensure we have a valid version.
  if (!params.versionName) {
    // since query.engine gives false if invalid, we can just check if its truthy
    // additionally if its false, we know the version will never be found.
    await common.NotFound(req, res);
    return;
  }

  // first lets get the package
  let pack = await data.GetPackageByName(params.packageName);

  if (!pack.ok) {
    await common.NotFound(req, res);
    return;
  }

  if (!pack.content.versions[params.versionName]) {
    // the package doesn't contain the version requested.
    await common.NotFound(req, res);
    return;
  }

  // lets add the download to the package.
  pack.content.downloads++;

  // then lets save this updated info.
  let save = await data.SetPackageByName(params.packageName, pack.content);

  if (!save.ok) {
    logger.WarningLog(req, res, save.content);
    // we don't want to exit on a failed to update downloads count, but should be logged.
  }
  // For simplicity, we will redirect the request to gh tarball url, to allow
  // the download to take place from their servers.
  res.redirect(pack.content.versions[params.versionName].tarball_url);
  logger.HTTPLog(req, res);
  return;
}

/**
 * @async
 * @function DELETEPackageVersion
 * @desc Allows a user to delete a specific version of their package.
 * @param {object} req - The `Request` object inherited from the Express endpoint.
 * @param {object} res - The `Response` object inherited from the Express endpoint.
 */
async function DELETEPackageVersion(req, res) {
  // DELETE /api/packages/:packageName/versions/:versionName
  let params = {
    auth: req.get("Authorization"),
    packageName: decodeURIComponent(req.params.packageName),
    versionName: req.params.versionName,
  };
  let user = await users.VerifyAuth(params.auth);

  if (!user.ok) {
    await common.AuthFail(req, res, user);
    return;
  }

  let gitowner = await git.Ownership(user.content, params.packageName);

  if (!gitowner.ok) {
    await common.HandleError(req, res, gitowner);
    return;
  }

  let pack = await data.GetPackageByName(params.packageName);

  if (!pack.ok) {
    // getting package returned error.
    await common.HandleError(req, res, pack);
    return;
  }

  if (!pack.content[params.versionName]) {
    // the version does not exist.
    // we will return not found for a non-existant version deletion.
    await common.NotFound(req, res);
  }

  // the version exists
  delete pack.content[params.versionName];

  // now to write back the modified data.
  let write = data.SetPackageByName(params.packageName, pack.content);

  if (!write.ok) {
    await common.HandleError(req, res, write);
    return;
  }

  // successfully wrote the modified data
  res.status(204).send();
}

/**
 * @async
 * @function POSTPackagesEventUninstall
 * @desc Used when a package is uninstalled, decreases the download count by 1.
 * And saves this data. Originally an undocumented endpoint.
 * @param {object} req - The `Request` object inherited from the Express endpoint.
 * @param {object} res - The `Response` object inherited from the Express endpoint.
 */
async function POSTPackagesEventUninstall(req, res) {
  // POST /api/packages/:packageName/versions/:versionName/events/uninstall
  // This was originally an Undocumented endpoint, discovered as the endpoint using during an uninstall by APM.
  // https://github.com/atom/apm/blob/master/src/uninstall.coffee
  // The decision to return a '201' was based on how other POST endpoints return, during a successful event.

  let params = {
    auth: req.get("Authorization"),
    packageName: decodeURIComponent(req.params.packageName),
    versionName: req.params.versionName,
  };

  const onLogin = async (user) => {
    let pack = await data.GetPackageByName(params.packageName);

    if (!pack.ok) {
      await common.HandleError(req, res, pack);
      return;
    }

    pack.content.downloads--;

    let write = await data.SetPackageByName(params.packageName, pack.content);

    if (!write.ok) {
      await common.HandleError(req, res, write);
      return;
    }

    res.status(201).json({ ok: true });
    logger.HTTPLog(req, res);
    return;
  };

  await utils.LocalUserLoggedIn(req, res, params.auth, onLogin);
}

module.exports = {
  GETPackages,
  POSTPackages,
  GETPackagesFeatured,
  GETPackagesSearch,
  GETPackagesDetails,
  DELETEPackagesName,
  POSTPackagesStar,
  DELETEPackagesStar,
  GETPackagesStargazers,
  POSTPackagesVersion,
  GETPackagesVersion,
  GETPackagesVersionTarball,
  DELETEPackageVersion,
  POSTPackagesEventUninstall,
};
