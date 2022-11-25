import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import action from './action';

process.on('unhandledRejection', handleError);
main().catch(handleError);

async function main() {
  const awsAccessKeyId = core.getInput('aws-access-key-id', { required: true });
  const awsSecretAccessKey = core.getInput('aws-secret-access-key', { required: true });
  const debug = core.getBooleanInput('debug');
  const doneIndicatorFileName = core.getInput('done-indicator-file-name');
  const doneWhenAssetSuffixesExist = core.getInput('done-when-asset-suffixes-exist');
  const releaseTag = core.getInput('release-tag', { required: true });
  const s3Bucket = core.getInput('s3-bucket', { required: true });
  const s3BucketPublicUrl = core.getInput('s3-bucket-public-url');
  const s3KeyPrefix = core.getInput('s3-key-prefix');
  const s3Region = core.getInput('s3-region', { required: true });
  const token = core.getInput('github-token', { required: true });

  const repo = context.repo;
  const owner = repo.owner;
  await action({
    awsAccessKeyId,
    awsSecretAccessKey,
    debug,
    doneIndicatorFileName,
    doneWhenAssetSuffixesExist,
    owner,
    releaseTag,
    repo: repo.repo,
    s3Bucket,
    s3BucketPublicUrl,
    s3KeyPrefix,
    s3Region,
    token,
  });
}

function handleError(err: any): void {
  console.error(err);
  core.setFailed(`Unhandled error: ${err}`);
}
