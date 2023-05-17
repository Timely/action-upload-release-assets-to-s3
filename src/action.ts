import { getOctokit } from '@actions/github';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import fetch from 'node-fetch';

interface Options {
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  debug: boolean;
  doneIndicatorFileName: string | undefined;
  doneWhenAssetSuffixesExist: string | undefined;
  owner: string;
  releaseTag: string;
  repo: string;
  s3Bucket: string;
  s3BucketPublicUrl: string | undefined;
  s3KeyPrefix: string;
  s3Region: string;
  token: string;
}
export default async function action({
  repo,
  owner,
  releaseTag,
  token,
  s3Bucket,
  awsAccessKeyId,
  awsSecretAccessKey,
  s3BucketPublicUrl,
  s3KeyPrefix,
  s3Region,
  debug,
  doneWhenAssetSuffixesExist,
  doneIndicatorFileName,
}: Options) {
  const logger = debug ? console : undefined;
  const github = getOctokit(token, {
    log: logger,
  });
  const s3 = new S3Client({
    credentials: {
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
    },
    region: s3Region,
  });

  if (releaseTag.startsWith('refs/tags/')) {
    releaseTag = releaseTag.replace('refs/tags/', '');
  }
  const releaseTagParsed = releaseTag.substring(releaseTag.indexOf('v') + 1);
  const pathOnS3 = s3KeyPrefix
    .replace('{release-tag}', releaseTag)
    .replace('{version-parsed-from-tag}', releaseTagParsed);

  console.info(
    'Will upload release assets for %s to S3 bucket %s, path `%s`',
    releaseTag,
    s3Bucket,
    pathOnS3
  );
  const release = await github.rest.repos
    .getReleaseByTag({
      owner,
      repo,
      tag: releaseTag,
    })
    .catch(e => {
      if (e.status === 404) {
        return github.rest.repos.listReleases({ owner, repo }).then(releases => {
          const release = releases.data.find(r => r.tag_name === releaseTag);
          if (!release) {
            throw new Error(`No release found for tag ${releaseTag}`);
          }
          return { data: release };
        });
      }
      throw e;
    })
    .then(({ data }) => data);

  let uploadedOrExistingAssets: Array<string> = [];
  for (const asset of release.assets) {
    if (asset.state !== 'uploaded') {
      continue;
    }
    if (asset.name === doneIndicatorFileName) {
      continue;
    }
    logger?.log('Considering asset %s', asset.name);
    let shouldUpload = true;
    try {
      const key = `${pathOnS3}/${asset.name}`;
      logger?.log('Checking if asset %s already exists on S3', key);
      const response = await s3.send(
        new HeadObjectCommand({
          Bucket: s3Bucket,
          Key: key,
        })
      );
      if (response.ContentLength === asset.size) {
        logger?.log('Asset exists on S3 already, skipping');
        shouldUpload = false;
        uploadedOrExistingAssets.push(asset.name);
      } else {
        logger?.log('Asset exists on S3 but has different size, will upload');
      }
    } catch (e) {
      const statusCode = (e as any)?.$metadata?.httpStatusCode;
      if (statusCode === 404) {
        shouldUpload = true;
      } else {
        throw e;
      }
    }

    if (!shouldUpload) {
      continue;
    }
    logger?.log('Preparing to upload %s to S3/%s', asset.name, pathOnS3);
    const fileResponse = await fetch(asset.url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' },
    });
    if (!fileResponse.ok) {
      throw new Error(
        `Failed to fetch asset ${asset.name}: (${asset.url}) HTTP ${fileResponse.status} ${fileResponse.statusText}`
      );
    }
    const file = new Uint8Array(await fileResponse.arrayBuffer());

    logger?.log('Downloaded from github, uploading to S3');
    await s3.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: `${pathOnS3}/${asset.name}`,
        Body: file,
      })
    );
    uploadedOrExistingAssets.push(asset.name);
    console.info('Uploaded to S3: %s/%s', pathOnS3, asset.name);
  }

  const expectedAssetSuffixes = doneWhenAssetSuffixesExist?.split(',') ?? [];

  const missingAssets = expectedAssetSuffixes.filter(
    suffix => !uploadedOrExistingAssets.some(asset => asset.endsWith(suffix))
  );

  if (missingAssets.length < 1 && doneIndicatorFileName) {
    console.info('All assets uploaded successfully, writing file to release');
    const existing_syncfile = release.assets.find(asset => asset.name === doneIndicatorFileName);
    if (existing_syncfile) {
      github.rest.repos.deleteReleaseAsset({
        owner,
        repo,
        release_id: release.id,
        asset_id: existing_syncfile.id,
      });
    }
    github.rest.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: release.id,
      name: doneIndicatorFileName,
      data: uploadedOrExistingAssets
        .map(file => (!!s3BucketPublicUrl ? `${s3BucketPublicUrl}/${pathOnS3}/${file}` : file))
        .join('\n'),
    });
  }
}
